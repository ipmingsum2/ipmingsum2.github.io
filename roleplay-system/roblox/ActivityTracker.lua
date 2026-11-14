--!nonstrict
--[[
	ActivityTracker — connects your game to the Roleplay System.

	Setup
	  1. Put this ModuleScript in ServerScriptService and name it "ActivityTracker".
	  2. Add a Script next to it:

	         local ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))
	         ActivityTracker.Start({
	             ApiUrl = "https://rp-roblox.pages.dev", -- the pages.dev relay: Roblox blocks *.workers.dev
	             ApiKey = "rpk_...", -- API key with the "game" scope (dashboard -> API)
	         })

	  3. Game Settings -> Security -> Allow HTTP Requests.

	What it does (server-side only — the API key never reaches clients)
	  * Every minute: who is in the server, their group rank, whether they were idle or on duty, and how many
	    chat messages they sent. The dashboard's Live servers page is built from this.
	  * When a player leaves: a session-end ping so the last partial minute counts.
	  * Blacklisted players are kicked when they join, and within a minute if they are added while in the server.
	  * Announcements, kicks and shutdowns sent from the dashboard arrive within a minute.

	Which ranks are tracked is configured in the dashboard (Groups -> Tracked ranks); nothing is hard-coded here.

	Optional config
	  IdleSeconds        number   seconds without moving before a player counts as idle (default 120)
	  KickBlacklisted    boolean  kick blacklisted players (default true)
	  KickMessage        string   shown to kicked players; {reason} is replaced (default below)
	  HeartbeatSeconds   number   how often to report (default 60; keep under 150)
	  ShowAnnouncements  boolean  show dashboard announcements with the built-in banner (default true)
	  Debug              boolean  print what is sent

	Admin system plugins (Adonis, Basic Admin Essentials, HD Admin, Kohl's Admin) call the functions at the
	bottom of this file. Your own scripts can use them too, e.g. ActivityTracker.SetOnDuty(player, true).
	Staff actions (warn, promote, blacklist, ...) only work for moderators whose Roblox account is linked to a
	dashboard account with the matching permission — an in-game admin rank alone is never enough.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TextService = game:GetService("TextService")

export type Config = {
	ApiUrl: string,
	ApiKey: string,
	IdleSeconds: number?,
	KickBlacklisted: boolean?,
	KickMessage: string?,
	HeartbeatSeconds: number?,
	ShowAnnouncements: boolean?,
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
local duty: { [Player]: string } = {} -- player -> duty label ("" when none)
local announcementHandlers: { (title: string, message: string, from: string?) -> () } = {}
local shuttingDown: string? = nil
local jobId = if game.JobId ~= "" then game.JobId else "studio-" .. HttpService:GenerateGUID(false)

local dutyChanged = Instance.new("BindableEvent")
--[[ Fires (player: Player, onDuty: boolean, label: string) whenever someone goes on or off duty. ]]
ActivityTracker.DutyChanged = dutyChanged.Event

local RANK_REFRESH_SECONDS = 300
local DEFAULT_KICK_MESSAGE = "You are blacklisted from this group. Reason: {reason}"
local NOT_RUNNING = "The Roleplay System isn't connected in this game (ActivityTracker.Start was not called)."

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
		warn(("[ActivityTracker] %s %s -> %d %s"):format(method, path, response.StatusCode, if decodedOk and data.error then data.error else ""))
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

-- ---------- on-screen notices (built on the server, so no client script is needed) ----------
local NOTICE_GUI = "RoleplaySystemNotices"

local function notice(player: Player, title: string, text: string, seconds: number?, accent: Color3?)
	local playerGui = player:FindFirstChildOfClass("PlayerGui")
	if not playerGui then
		return
	end
	local holder = playerGui:FindFirstChild(NOTICE_GUI)
	if not holder then
		holder = Instance.new("ScreenGui")
		holder.Name = NOTICE_GUI
		holder.ResetOnSpawn = false
		holder.DisplayOrder = 60
		local list = Instance.new("Frame")
		list.Name = "List"
		list.BackgroundTransparency = 1
		list.AnchorPoint = Vector2.new(0.5, 0)
		list.Position = UDim2.new(0.5, 0, 0, 14)
		list.Size = UDim2.new(0.92, 0, 1, -28)
		local limit = Instance.new("UISizeConstraint")
		limit.MaxSize = Vector2.new(440, math.huge)
		limit.Parent = list
		local layout = Instance.new("UIListLayout")
		layout.Padding = UDim.new(0, 8)
		layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
		layout.SortOrder = Enum.SortOrder.LayoutOrder
		layout.Parent = list
		list.Parent = holder
		holder.Parent = playerGui
	end
	local card = Instance.new("Frame")
	card.Name = "Notice"
	card.LayoutOrder = math.floor(os.clock() * 1000) % 2 ^ 30
	card.Size = UDim2.new(1, 0, 0, 0)
	card.AutomaticSize = Enum.AutomaticSize.Y
	card.BackgroundColor3 = Color3.fromRGB(22, 24, 30)
	card.BackgroundTransparency = 0.06
	Instance.new("UICorner", card).CornerRadius = UDim.new(0, 10)
	local stroke = Instance.new("UIStroke")
	stroke.Color = accent or Color3.fromRGB(91, 141, 239)
	stroke.Thickness = 1.5
	stroke.Parent = card
	local pad = Instance.new("UIPadding")
	pad.PaddingTop, pad.PaddingBottom = UDim.new(0, 10), UDim.new(0, 12)
	pad.PaddingLeft, pad.PaddingRight = UDim.new(0, 14), UDim.new(0, 14)
	pad.Parent = card
	local stack = Instance.new("UIListLayout")
	stack.Padding = UDim.new(0, 4)
	stack.SortOrder = Enum.SortOrder.LayoutOrder
	stack.Parent = card
	local function label(textValue: string, font: Enum.Font, size: number, color: Color3, order: number)
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Size = UDim2.new(1, 0, 0, 0)
		l.AutomaticSize = Enum.AutomaticSize.Y
		l.TextWrapped = true
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.Font = font
		l.TextSize = size
		l.TextColor3 = color
		l.Text = textValue
		l.LayoutOrder = order
		l.Parent = card
	end
	label(title, Enum.Font.GothamBold, 16, Color3.new(1, 1, 1), 1)
	label(text, Enum.Font.Gotham, 14, Color3.fromRGB(214, 218, 226), 2)
	card.Parent = holder.List
	task.delay(seconds or 8, function()
		card:Destroy()
	end)
end

local function filterForBroadcast(text: string, fromUserId: number?): string
	local sender = fromUserId
	if not sender then
		local anyone = Players:GetPlayers()[1]
		sender = anyone and anyone.UserId
	end
	if not sender then
		return text
	end
	local ok, result = pcall(function()
		return TextService:FilterStringAsync(text, sender):GetNonChatStringForBroadcastAsync()
	end)
	return if ok then result else "(message could not be shown)"
end

-- ---------- kicks ----------
local function kick(player: Player, reason: string?)
	if config.KickBlacklisted == false or player.Parent ~= Players then
		return
	end
	local message = string.gsub(config.KickMessage or DEFAULT_KICK_MESSAGE, "{reason}", function()
		return reason or "not given"
	end)
	log("kicking blacklisted player", player.UserId)
	player:Kick(message)
end

local function checkBlacklist(player: Player)
	if config.KickBlacklisted == false then
		return
	end
	local ok, data = request("GET", "/v1/game/blacklist/" .. player.UserId)
	if ok and data and data.blacklisted then
		kick(player, data.reason)
	end
end

local function onPlayerAdded(player: Player)
	if shuttingDown then
		player:Kick(shuttingDown)
		return
	end
	task.spawn(checkBlacklist, player)
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
	duty[player] = nil
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

-- ---------- commands sent from the dashboard ----------
local function announce(title: string, message: string, from: string?, seconds: number?)
	if #announcementHandlers > 0 then
		for _, handler in announcementHandlers do
			task.spawn(handler, title, message, from)
		end
		return
	end
	if config.ShowAnnouncements == false then
		return
	end
	local text = if from then ("%s\n— %s"):format(message, from) else message
	for _, player in Players:GetPlayers() do
		notice(player, title, text, seconds or 12, Color3.fromRGB(245, 165, 36))
	end
end

local function runCommand(command: any)
	if command.type == "announce" then
		local title = filterForBroadcast(tostring(command.title or "Announcement"), command.fromUserId)
		local message = filterForBroadcast(tostring(command.message or ""), command.fromUserId)
		announce(title, message, command.from, tonumber(command.seconds))
	elseif command.type == "kick" then
		local player = Players:GetPlayerByUserId(tonumber(command.userId) or 0)
		if player then
			player:Kick("Removed by staff. Reason: " .. tostring(command.reason or "not given"))
		end
	elseif command.type == "shutdown" then
		shuttingDown = tostring(command.message or "This server was shut down by staff.")
		for _, player in Players:GetPlayers() do
			player:Kick(shuttingDown)
		end
	end
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
			onDuty = duty[player] ~= nil,
			dutyLabel = duty[player],
		})
		state.messages = 0
	end
	if #list == 0 then
		return
	end
	local ok, data = request("POST", "/v1/game/heartbeat", { jobId = jobId, placeId = game.PlaceId, players = list })
	if ok and data then
		log(("heartbeat sent: %d players, %d tracked"):format(#list, data.tracked or 0))
		-- Players blacklisted while already in this server.
		for _, entry in data.kick or {} do
			local player = Players:GetPlayerByUserId(entry.userId)
			if player then
				kick(player, entry.reason)
			end
		end
		for _, command in data.commands or {} do
			task.spawn(runCommand, command)
		end
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
	_G.RoleplaySystem = ActivityTracker -- lets admin-system plugins find this module wherever it lives

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

--[[ True once Start was called. ]]
function ActivityTracker.IsRunning(): boolean
	return started
end

--[[ The player's cached rank in the tracked group (0 if unknown). Handy for other scripts. ]]
function ActivityTracker.GetRank(player: Player): number
	local state = states[player]
	return if state then state.rank else 0
end

-- =====================================================================
-- Duty
-- =====================================================================

--[[ Puts a player on or off duty. Time on duty is counted separately on the dashboard. label is optional
     (e.g. a department or vehicle) and shows on the Live servers page. ]]
function ActivityTracker.SetOnDuty(player: Player, on: boolean, label: string?)
	if on then
		duty[player] = string.sub(label or "", 1, 40)
	else
		duty[player] = nil
	end
	player:SetAttribute("RPOnDuty", if on then true else nil)
	dutyChanged:Fire(player, on, label or "")
end

function ActivityTracker.IsOnDuty(player: Player): boolean
	return duty[player] ~= nil
end

--[[ Everyone on duty in this server. ]]
function ActivityTracker.GetOnDuty(): { Player }
	local list = {}
	for player in duty do
		table.insert(list, player)
	end
	table.sort(list, function(a, b)
		return a.Name < b.Name
	end)
	return list
end

-- =====================================================================
-- Notices and announcements
-- =====================================================================

--[[ Shows a small notice on one player's screen (used by the plugins when an admin system has no UI call). ]]
function ActivityTracker.Notify(player: Player, title: string, text: string, seconds: number?)
	notice(player, title, text, seconds)
end

--[[ Replace the built-in banner for dashboard announcements, e.g. to use your admin system's UI.
     handler(title, message, fromName) runs once per announcement; text is already filtered. ]]
function ActivityTracker.OnAnnouncement(handler: (string, string, string?) -> ())
	table.insert(announcementHandlers, handler)
end

-- =====================================================================
-- Lookups, staff actions and the moderation log (used by the admin plugins)
-- =====================================================================

local function userIdOf(target: any): number?
	if typeof(target) == "Instance" and target:IsA("Player") then
		return target.UserId
	end
	local n = tonumber(target)
	if n then
		return n
	end
	if type(target) == "string" and target ~= "" then
		for _, player in Players:GetPlayers() do -- online players by name or display name prefix
			local name = string.lower(target)
			if string.lower(player.Name) == name or string.lower(player.DisplayName) == name then
				return player.UserId
			end
		end
		local ok, id = pcall(Players.GetUserIdFromNameAsync, Players, target)
		return if ok then id else nil
	end
	return nil
end

local function duration(seconds: number): string
	local m = math.floor((seconds or 0) / 60 + 0.5)
	local h = math.floor(m / 60)
	return if h > 0 then ("%dh %02dm"):format(h, m % 60) else ("%dm"):format(m)
end

--[[ Fetches a player's roster profile. Returns (true, data) or (false, message). ]]
function ActivityTracker.Lookup(target: Player | number | string): (boolean, any)
	if not config then
		return false, NOT_RUNNING
	end
	local id = userIdOf(target)
	if not id then
		return false, "Player not found."
	end
	local ok, data = request("GET", "/v1/game/profile/" .. id)
	if not ok or not data then
		return false, if data and data.error then data.error else "The Roleplay System did not answer."
	end
	return true, data
end

--[[ Turns Lookup data into short lines for any admin UI. ]]
function ActivityTracker.FormatProfile(data: any): { string }
	local lines = {}
	local name = data.username or ("User " .. tostring(data.robloxId))
	table.insert(lines, if data.roleName then ("%s — %s"):format(name, data.roleName) else ("%s — not in the group's tracked ranks"):format(name))
	local roster = {}
	if data.callsign and data.callsign ~= "" then
		table.insert(roster, "Callsign " .. data.callsign)
	end
	if data.departments and #data.departments > 0 then
		table.insert(roster, table.concat(data.departments, ", "))
	end
	if #roster > 0 then
		table.insert(lines, table.concat(roster, " · "))
	end
	if data.certifications and #data.certifications > 0 then
		local names = {}
		for _, cert in data.certifications do
			table.insert(names, cert.name)
		end
		table.insert(lines, "Certified: " .. table.concat(names, ", "))
	end
	local week = data.week or {}
	table.insert(lines, ("This week: %s played · %s on duty · %d session%s"):format(duration(week.seconds), duration(week.dutySeconds), week.sessions or 0, if week.sessions == 1 then "" else "s"))
	table.insert(lines, ("Active warnings: %d"):format(data.activeWarnings or 0))
	for _, entry in data.recent or {} do
		table.insert(lines, ("  %s by %s: %s"):format(entry.type, entry.by or "?", entry.reason or ""))
	end
	if data.onLeaveUntil then
		table.insert(lines, "On leave until " .. data.onLeaveUntil)
	end
	if data.blacklisted then
		table.insert(lines, "BLACKLISTED: " .. tostring(data.blacklisted.reason))
	end
	return lines
end

--[[ Runs a staff action as the moderator's linked dashboard account.
     action: "warn" | "strike" | "blacklist" | "promote" | "demote" | "setrank" | "certify"
     options: {reason: string?, rank: number?, cert: string?}
     Returns (ok, message) — show the message to the moderator as-is. ]]
function ActivityTracker.StaffAction(actor: Player, action: string, target: Player | number | string, options: { [string]: any }?): (boolean, string)
	if not config then
		return false, NOT_RUNNING
	end
	options = options or {}
	local targetText = if typeof(target) == "Instance" then tostring(target.UserId) else tostring(target or "")
	local ok, data = request("POST", "/v1/game/staff", {
		actorId = actor.UserId,
		action = action,
		target = targetText,
		reason = options.reason,
		rank = options.rank,
		cert = options.cert,
	})
	if not data then
		return false, "The Roleplay System did not answer."
	end
	return ok and data.ok == true, tostring(data.message or data.error or "Done.")
end

--[[ Records something an admin system did (kick, ban, unban, warn, mute) in the dashboard's moderation log.
     entry: {action, target (Player | userId | username), reason?, duration? (seconds, -1 = permanent),
             moderator (Player | userId)?, source (e.g. "Adonis")?}. Runs in the background. ]]
function ActivityTracker.ReportModeration(entry: { [string]: any })
	if not config then
		return
	end
	task.spawn(function()
		local target, moderator = entry.target, entry.moderator
		local body = {
			action = entry.action,
			reason = if entry.reason then string.sub(tostring(entry.reason), 1, 500) else nil,
			duration = entry.duration,
			source = entry.source,
			jobId = jobId,
		}
		if typeof(target) == "Instance" then
			body.userId, body.username = target.UserId, target.Name
		elseif tonumber(target) then
			body.userId = tonumber(target)
		else
			body.username = tostring(target or "")
		end
		if typeof(moderator) == "Instance" then
			body.moderatorId, body.moderatorName = moderator.UserId, moderator.Name
		elseif tonumber(moderator) then
			body.moderatorId = tonumber(moderator)
			local p = Players:GetPlayerByUserId(body.moderatorId)
			body.moderatorName = if p then p.Name else nil
		end
		request("POST", "/v1/game/moderation", body)
	end)
end

--[[ Records a shift event in the dashboard's Logs (filter "Shifts"). Used by clocking-system addons.
     event: "clock_in" | "clock_out" | "break_start" | "break_end"; by: the manager who did it for them (optional).
     Runs in the background. ]]
function ActivityTracker.ReportShift(player: Player, event: string, by: Player?, source: string?)
	if not config then
		return
	end
	task.spawn(request, "POST", "/v1/game/shift", {
		userId = player.UserId,
		username = player.Name,
		event = event,
		byUserId = if by and by ~= player then by.UserId else nil,
		byName = if by and by ~= player then by.Name else nil,
		source = source,
	})
end

--[[ The shared command set every admin plugin exposes. Returns (ok, message, lines?).
     name: "info" | "warn" | "strike" | "blacklist" | "promote" | "demote" | "cert" | "duty" | "onduty"
     target: the player named in the command (or nil for duty / onduty); text: the rest of the message. ]]
function ActivityTracker.RunCommand(name: string, caller: Player, target: (Player | number | string)?, text: string?): (boolean, string, { string }?)
	if not config then
		return false, NOT_RUNNING
	end
	text = if text then (string.gsub(text, "^%s+", "")) else ""
	if name == "duty" then
		local on = not ActivityTracker.IsOnDuty(caller)
		ActivityTracker.SetOnDuty(caller, on, if text ~= "" then text else nil)
		return true, if on then "You are now on duty." else "You are now off duty."
	elseif name == "onduty" then
		local lines = {}
		for _, player in ActivityTracker.GetOnDuty() do
			local label = duty[player]
			table.insert(lines, if label and label ~= "" then ("%s — %s"):format(player.Name, label) else player.Name)
		end
		return true, if #lines == 0 then "Nobody is on duty in this server." else ("%d on duty"):format(#lines), lines
	end
	if target == nil or target == "" then
		return false, "Name a player."
	end
	if name == "info" then
		local ok, data = ActivityTracker.Lookup(target)
		if not ok then
			return false, data
		end
		local lines = ActivityTracker.FormatProfile(data)
		return true, lines[1], lines
	elseif name == "cert" then
		if text == "" then
			return false, "Name the certification, e.g. rpcert Builderman Firearms"
		end
		return ActivityTracker.StaffAction(caller, "certify", target, { cert = text })
	elseif name == "warn" or name == "strike" or name == "blacklist" or name == "promote" or name == "demote" then
		return ActivityTracker.StaffAction(caller, name, target, { reason = if text ~= "" then text else nil })
	end
	return false, "Unknown command."
end

return ActivityTracker
