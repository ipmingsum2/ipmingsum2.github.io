--[[
	Roleplay System — addon for DRS | Store Operations (Direct Retail Solutions)

	Install: put this Script in ServerScriptService, next to the ActivityTracker module (which holds the API key).
	Leave the DRS kit itself unchanged — this addon only listens, so the kit's tamper checks are not affected.

	What it does
	  * Clocking in on the DRS clock machine, with /clockin, or from the manager panel puts the player on duty in the
	    Roleplay System; clocking out takes them off duty. Time on duty shows on each member's page and the Live
	    servers page shows who is clocked in.
	  * Breaks: by default a player on break is off duty (break time is not counted). Set COUNT_BREAKS_AS_DUTY below
	    to count it.
	  * Every clock in, clock out and break is written to the dashboard's Logs (filter "Shifts"), including who did
	    it when a manager clocks someone in or out.
	  * Announcements sent from the dashboard's Live servers page appear in the DRS announcement banner.

	The addon follows the kit's own rules (group, minimum ranks, machine or chat-command mode) by reading
	DRS | Store Operations Bundle > Configuration > MasterConfig, so there is nothing to configure twice.

	Tip: the kit also has its own activity tracking (MasterConfig > ActivityTracking), which sends playtime to
	Direct Retail Solutions. If the Roleplay System is all you need, you can set ActivityTracking.Enabled = false.
]]

local COUNT_BREAKS_AS_DUTY = false -- true: time on break still counts as time on duty
local USE_DRS_ANNOUNCEMENTS = true -- show dashboard announcements in the DRS banner instead of the built-in one
local DUTY_LABEL = "Clocked in" -- shown on the Live servers page
local BREAK_LABEL = "On break"
local SOURCE = "DRS Store Operations"

local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")
local TextChatService = game:GetService("TextChatService")

local function RP()
	local api = rawget(_G, "RoleplaySystem")
	if api then
		return api
	end
	local module = ServerScriptService:FindFirstChild("ActivityTracker", true)
	return if module and module:IsA("ModuleScript") then require(module) else nil
end

local bundle = workspace:WaitForChild("DRS | Store Operations Bundle", 60)
if not bundle then
	warn("[Roleplay System] DRS addon: 'DRS | Store Operations Bundle' was not found in Workspace — is the kit installed?")
	return
end
local rp = RP()
if not rp then
	warn("[Roleplay System] DRS addon: the ActivityTracker module was not found in ServerScriptService.")
	return
end
local okConfig, master = pcall(function()
	return require(bundle:WaitForChild("Configuration", 30):WaitForChild("MasterConfig", 30))
end)
if not okConfig or type(master) ~= "table" or type(master.Clocking) ~= "table" then
	warn("[Roleplay System] DRS addon: could not read the kit's MasterConfig:", master)
	return
end
local config = master.Clocking
local send: RemoteEvent? = bundle:FindFirstChild("Send")

-- ---------- rank checks (same rules as the kit, cached per player) ----------
local rankCache: { [Player]: number } = {}
local function rankOf(player: Player): number
	local cached = rankCache[player]
	if cached then
		return cached
	end
	local ok, rank = pcall(player.GetRankInGroup, player, config.GroupId)
	rank = if ok then rank else 0
	rankCache[player] = rank
	return rank
end
local function isStaff(player: Player): boolean
	return rankOf(player) >= (config.MinRank or 0)
end
local function isManager(player: Player): boolean
	return rankOf(player) >= (config.MgrMinRank or math.huge)
end

-- ---------- a mirror of the kit's clock state ----------
-- The kit keeps its state private, so the addon applies the same changes to its own copy from the same inputs.
type State = { clockedIn: boolean, onBreak: boolean }
local states: { [Player]: State } = {}

local function apply(player: Player, state: State)
	local onDuty = state.clockedIn and (COUNT_BREAKS_AS_DUTY or not state.onBreak)
	local label = if state.clockedIn and state.onBreak then BREAK_LABEL else DUTY_LABEL
	rp.SetOnDuty(player, onDuty, if onDuty then label else nil)
end

local function stateOf(player: Player, create: boolean): State?
	local s = states[player]
	if not s and create and isStaff(player) then
		s = { clockedIn = false, onBreak = false }
		states[player] = s
	end
	return s
end

local function setClockedIn(player: Player, value: boolean, by: Player?)
	local s = stateOf(player, true)
	if not s or s.clockedIn == value then
		return
	end
	s.clockedIn = value
	if not value and s.onBreak then
		s.onBreak = false
		rp.ReportShift(player, "break_end", by, SOURCE)
	end
	rp.ReportShift(player, if value then "clock_in" else "clock_out", by, SOURCE)
	apply(player, s)
end

local function setOnBreak(player: Player, value: boolean, by: Player?)
	local s = stateOf(player, true)
	if not s or s.onBreak == value then
		return
	end
	s.onBreak = value
	rp.ReportShift(player, if value then "break_start" else "break_end", by, SOURCE)
	apply(player, s)
end

-- ---------- inputs ----------
-- 1. The clock machine screen and the manager panel (client -> server).
if send and send:IsA("RemoteEvent") then
	send.OnServerEvent:Connect(function(player, action, request)
		if type(request) ~= "table" then
			return
		end
		if action == "SetStatus" then
			if not isStaff(player) then
				return
			end
			if request.StatusType == "clockedIn" then
				setClockedIn(player, request.Value == true)
			elseif request.StatusType == "Break" then
				setOnBreak(player, request.Value == true)
			end
		elseif action == "MGR_SetStatus" then
			if not isManager(player) or type(request.PlrName) ~= "string" then
				return
			end
			local target = Players:FindFirstChild(request.PlrName)
			if not (target and target:IsA("Player") and states[target]) then
				return -- the kit ignores targets it has no state for
			end
			if request.StatusType == "clockedIn" then
				setClockedIn(target, request.Value == true, player)
			end
			-- The kit's manager "Break" button does not change the break state, so neither does the addon.
		end
	end)
end

-- 2. Chat commands (/clockin, /clockout, /break) when the kit runs in "cmd" mode.
if config.Enabled ~= false and config.Type == "cmd" then
	task.spawn(function()
		local folder = TextChatService:WaitForChild("TextChatCommands", 30)
		if not folder then
			return
		end
		local function hook(name: string, fn: (Player) -> ())
			local command = folder:WaitForChild(name, 30)
			if command and command:IsA("TextChatCommand") then
				command.Triggered:Connect(function(source: TextSource)
					local player = Players:GetPlayerByUserId(source.UserId)
					if player and isStaff(player) then
						fn(player)
					end
				end)
			end
		end
		task.spawn(hook, "DRS_ClockIn", function(player)
			setClockedIn(player, true)
		end)
		task.spawn(hook, "DRS_ClockOut", function(player)
			setClockedIn(player, false)
		end)
		task.spawn(hook, "DRS_Break", function(player)
			local s = states[player]
			if s and s.clockedIn then
				setOnBreak(player, not s.onBreak)
			end
		end)
	end)
end

-- 3. Scanning a clocking-capable tool on a clock machine, when the kit runs in "machine" mode.
if config.Enabled ~= false and config.Type == "machine" then
	local busy: { [Player]: boolean } = {}
	local function watchMachine(machine: Instance)
		local sensor = machine:WaitForChild("Timetac Sensor", 30)
		local scanPart = sensor and sensor:WaitForChild("ScanPart", 30)
		if not (scanPart and scanPart:IsA("BasePart")) then
			return
		end
		scanPart.Touched:Connect(function(hit)
			local tool = hit.Parent
			if not (tool and tool:IsA("Tool")) then
				return
			end
			local marker = tool:FindFirstChild("DRS_ClockingCapable")
			if not (marker and marker:IsA("BoolValue")) then
				return
			end
			local player = Players:GetPlayerFromCharacter(tool.Parent)
			if not player or not isStaff(player) or busy[player] then
				return
			end
			local s = stateOf(player, true)
			if not s then
				return
			end
			busy[player] = true -- the kit ignores repeat scans for 4.5 seconds
			setClockedIn(player, not s.clockedIn)
			task.delay(4.5, function()
				busy[player] = nil
			end)
		end)
	end
	local machines = bundle:WaitForChild("ClockMachines", 30)
	if machines then
		for _, machine in machines:GetChildren() do
			task.spawn(watchMachine, machine)
		end
		machines.ChildAdded:Connect(watchMachine)
	end
end

-- ---------- players ----------
Players.PlayerRemoving:Connect(function(player)
	local s = states[player]
	if s and s.clockedIn then
		rp.ReportShift(player, "clock_out", nil, SOURCE .. " (left the game)")
	end
	states[player] = nil
	rankCache[player] = nil
end)

-- ---------- dashboard announcements in the DRS banner ----------
if USE_DRS_ANNOUNCEMENTS and send and send:IsA("RemoteEvent") and rp.OnAnnouncement then
	rp.OnAnnouncement(function(title: string, message: string, from: string?)
		local text = if title ~= "" and title ~= "Announcement" then ("%s: %s"):format(title, message) else message
		if from then
			text ..= " — " .. from
		end
		send:FireAllClients("announce", text)
	end)
end

print("[Roleplay System] DRS Store Operations addon running (" .. tostring(config.Type) .. " mode).")
