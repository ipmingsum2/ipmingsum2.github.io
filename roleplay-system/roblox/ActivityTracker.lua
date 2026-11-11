--!nonstrict
--[[
	ActivityTracker — reports playtime to the Roleplay System API.

	Setup
	  1. Put this ModuleScript in ServerScriptService and name it "ActivityTracker".
	  2. Add a Script next to it:

	         local ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))
	         ActivityTracker.Start({
	             ApiUrl = "https://rp-roblox.pages.dev", -- the pages.dev relay: Roblox blocks *.workers.dev
	             ApiKey = "rpk_...", -- API key with the "game" scope (dashboard → API)
	         })

	  3. Game Settings → Security → Allow HTTP Requests.

	What it sends (server-side only — the API key never reaches clients)
	  * Every minute: who is in the server, their group rank, whether they were idle, and how many chat messages they sent.
	  * When a player leaves: a session-end ping so the last partial minute counts.

	Which ranks are tracked is configured in the dashboard (Groups → Tracked ranks); nothing is hard-coded here.

	Optional config
	  IdleSeconds        number   seconds without moving before a player counts as idle (default 120)
	  HeartbeatSeconds   number   how often to report (default 60; keep under 150)
	  Debug              boolean  print what is sent
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

export type Config = {
	ApiUrl: string,
	ApiKey: string,
	IdleSeconds: number?,
	HeartbeatSeconds: number?,
	Debug: boolean?,
}

type PlayerState = {
	rank: number,
	role: string,
	rankCheckedAt: number,
	lastPosition: Vector3?,
	lastMovedAt: number,
	messages: number,
}

local ActivityTracker = {}

local started = false
local config: Config
local groupId = 0
local trackedRanks: { [number]: boolean } = {}
local states: { [Player]: PlayerState } = {}
local jobId = if game.JobId ~= "" then game.JobId else "studio-" .. HttpService:GenerateGUID(false)

local RANK_REFRESH_SECONDS = 300

local function log(...: any)
	if config and config.Debug then
		print("[ActivityTracker]", ...)
	end
end

local function request(method: string, path: string, body: any?): (boolean, any)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = config.ApiUrl .. path,
			Method = method,
			Headers = {
				["Content-Type"] = "application/json",
				["X-Api-Key"] = config.ApiKey,
			},
			Body = if body then HttpService:JSONEncode(body) else nil,
		})
	end)
	if not ok then
		warn("[ActivityTracker] request failed:", response)
		return false, nil
	end
	local decodedOk, data = pcall(HttpService.JSONDecode, HttpService, response.Body)
	if not response.Success then
		warn(("[ActivityTracker] %s %s → %d %s"):format(method, path, response.StatusCode, if decodedOk and data.error then data.error else ""))
		return false, if decodedOk then data else nil
	end
	return true, if decodedOk then data else nil
end

local function loadConfig(): boolean
	local ok, data = request("GET", "/v1/game/config")
	if not ok or not data then
		return false
	end
	groupId = tonumber(data.groupId) or 0
	table.clear(trackedRanks)
	for _, rank in data.trackedRanks do
		trackedRanks[rank] = true
	end
	log("config loaded for group", groupId)
	return groupId > 0
end

local function refreshRank(player: Player, state: PlayerState)
	local okRank, rank = pcall(player.GetRankInGroup, player, groupId)
	local okRole, role = pcall(player.GetRoleInGroup, player, groupId)
	if okRank then
		state.rank = rank
	end
	if okRole then
		state.role = role
	end
	state.rankCheckedAt = os.clock()
end

local function onPlayerAdded(player: Player)
	local state: PlayerState = {
		rank = 0,
		role = "Guest",
		rankCheckedAt = 0,
		lastPosition = nil,
		lastMovedAt = os.clock(),
		messages = 0,
	}
	states[player] = state
	refreshRank(player, state)
	player.Chatted:Connect(function()
		state.messages += 1
		state.lastMovedAt = os.clock() -- chatting counts as being present
	end)
end

local function onPlayerRemoving(player: Player)
	local state = states[player]
	states[player] = nil
	if state and trackedRanks[state.rank] then
		task.spawn(request, "POST", "/v1/game/session-end", { jobId = jobId, userId = player.UserId })
	end
end

local function isIdle(player: Player, state: PlayerState): boolean
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		local position = root.Position
		if not state.lastPosition or (position - state.lastPosition).Magnitude > 1 then
			state.lastPosition = position
			state.lastMovedAt = os.clock()
		end
	end
	return os.clock() - state.lastMovedAt >= (config.IdleSeconds or 120)
end

local function heartbeat()
	local list = {}
	for player, state in states do
		if os.clock() - state.rankCheckedAt > RANK_REFRESH_SECONDS then
			refreshRank(player, state)
		end
		-- Untracked ranks are still listed (with no activity recorded) so the API notices demotions.
		table.insert(list, {
			userId = player.UserId,
			username = player.Name,
			displayName = player.DisplayName,
			rank = state.rank,
			role = state.role,
			idle = isIdle(player, state),
			messages = state.messages,
		})
		state.messages = 0
	end
	if #list == 0 then
		return
	end
	local ok, data = request("POST", "/v1/game/heartbeat", { jobId = jobId, players = list })
	if ok and data then
		log(("heartbeat sent: %d players, %d tracked"):format(#list, data.tracked or 0))
	end
end

--[[ Starts tracking. Safe to call once; later calls are ignored. ]]
function ActivityTracker.Start(userConfig: Config)
	assert(RunService:IsServer(), "ActivityTracker must be required from a server Script")
	assert(type(userConfig) == "table", "ActivityTracker.Start expects a config table")
	assert(type(userConfig.ApiUrl) == "string" and userConfig.ApiUrl ~= "", "ApiUrl is required")
	assert(type(userConfig.ApiKey) == "string" and userConfig.ApiKey ~= "", "ApiKey is required")
	if started then
		return
	end
	started = true
	config = table.clone(userConfig)
	config.ApiUrl = string.gsub(config.ApiUrl, "/+$", "")

	task.spawn(function()
		-- Retry until the API answers (HTTP may be disabled, or the Worker briefly unreachable).
		local delaySeconds = 5
		while not loadConfig() do
			warn(("[ActivityTracker] could not load config; retrying in %ds. Is 'Allow HTTP Requests' on and the API key valid?"):format(delaySeconds))
			task.wait(delaySeconds)
			delaySeconds = math.min(delaySeconds * 2, 120)
		end

		for _, player in Players:GetPlayers() do
			task.spawn(onPlayerAdded, player)
		end
		Players.PlayerAdded:Connect(onPlayerAdded)
		Players.PlayerRemoving:Connect(onPlayerRemoving)

		local interval = math.clamp(config.HeartbeatSeconds or 60, 30, 150)
		local sinceConfig = 0
		while true do
			task.wait(interval)
			sinceConfig += interval
			if sinceConfig >= 600 then -- pick up tracked-rank changes made in the dashboard
				sinceConfig = 0
				loadConfig()
			end
			heartbeat()
		end
	end)
end

--[[ The player's cached rank in the tracked group (0 if unknown). Handy for other scripts. ]]
function ActivityTracker.GetRank(player: Player): number
	local state = states[player]
	return if state then state.rank else 0
end

return ActivityTracker
