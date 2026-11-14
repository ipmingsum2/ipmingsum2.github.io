--[[
	Roleplay System — HD Admin v1 (classic, v1.x) commands

	Install:
	  1. Right-click HD Admin > Config > Commands > Server in Studio, choose "Insert from File…" and pick the
	     downloaded .rbxmx. This ModuleScript ("RoleplaySystem") ends up inside the Server module.
	  2. Open the Server module and add this line just above its final "return module":

	         for _, command in require(script.RoleplaySystem) do table.insert(module, command) end

	The ActivityTracker module must be running in the same game (ServerScriptService); it holds the API key.
	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission. Ranks: 0 everyone, 1 VIP, 2 Mod, 3 Admin, 4 HeadAdmin, 5 Owner.
]]

local STAFF_RANK = 2

local main = _G.HDAdminMain
local settings = main.settings

local function RP()
	local api = rawget(_G, "RoleplaySystem")
	if api then
		return api
	end
	local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
	return if module and module:IsA("ModuleScript") then require(module) else nil
end

local function tell(player: Player, ok: boolean, message: string, lines: { string }?)
	local rp = RP()
	if lines and #lines > 1 and rp then
		rp.Notify(player, "Roleplay System", table.concat(lines, "\n"), 15) -- long text reads better in a card
		return
	end
	local sent = pcall(function()
		main.signals.Notice:FireClient(player, { if ok then "Roleplay System" else "Roleplay System — error", message })
	end)
	if not sent and rp then
		rp.Notify(player, "Roleplay System", message)
	end
end

-- HD Admin runs a "Player" command once per targeted player; only the first in a burst goes through, so
-- ";rpwarn all ..." can't warn a whole server by accident.
local lastRun: { [Player]: { [string]: number } } = {}
local function firstInBurst(speaker: Player, name: string): boolean
	lastRun[speaker] = lastRun[speaker] or {}
	local t = lastRun[speaker][name]
	lastRun[speaker][name] = os.clock()
	return not t or os.clock() - t > 1
end
game:GetService("Players").PlayerRemoving:Connect(function(player)
	lastRun[player] = nil
end)

local function run(name: string, speaker: Player, target: Player?, text: string?)
	if target and not firstInBurst(speaker, name) then
		return tell(speaker, false, "Pick one player at a time.")
	end
	local rp = RP()
	if not rp then
		return tell(speaker, false, "ActivityTracker was not found in ServerScriptService.")
	end
	local ok, message, lines = rp.RunCommand(name, speaker, target, text)
	tell(speaker, ok, message, lines)
end

local function command(name: string, rpName: string, rank: number, args: { string }, description: string)
	return {
		Name = name,
		Aliases = {},
		Prefixes = { settings.Prefix },
		Rank = rank,
		RankLock = false,
		Loopable = false,
		Tags = { "Roleplay System" },
		Description = description,
		Contributors = {},
		Args = args,
		Function = function(speaker, args)
			if args[1] ~= nil and typeof(args[1]) == "Instance" then
				run(rpName, speaker, args[1], args[2])
			else
				run(rpName, speaker, nil, args[1])
			end
		end,
	}
end

return {
	command("rpinfo", "info", STAFF_RANK, { "Player" }, "Roleplay System: rank, callsign, departments, certifications, activity and warnings."),
	command("rpwarn", "warn", STAFF_RANK, { "Player", "Text" }, "Roleplay System: log a warning in the dashboard logbook."),
	command("rpstrike", "strike", STAFF_RANK, { "Player", "Text" }, "Roleplay System: log a strike in the dashboard logbook."),
	command("rppromote", "promote", STAFF_RANK, { "Player", "Text" }, "Roleplay System: promote one rank in the group."),
	command("rpdemote", "demote", STAFF_RANK, { "Player", "Text" }, "Roleplay System: demote one rank in the group."),
	command("rpblacklist", "blacklist", STAFF_RANK, { "Player", "Text" }, "Roleplay System: blacklist from the group."),
	command("rpcert", "cert", STAFF_RANK, { "Player", "Text" }, "Roleplay System: award or renew a certification."),
	command("duty", "duty", 0, { "Text" }, "Roleplay System: go on or off duty."),
	command("onduty", "onduty", 0, {}, "Roleplay System: who is on duty in this server."),
}
