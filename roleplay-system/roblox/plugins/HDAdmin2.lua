--!strict
--[[
	Roleplay System — HD Admin v2 commands

	Install: right-click HD Admin > Config > Commands in Studio, choose "Insert from File…" and pick the
	downloaded .rbxmx. HD Admin loads every command module in that folder.

	Which roles can use the commands is decided by their tags: STAFF_TAGS go with the Mod commands and
	EVERYONE_TAGS with the Player commands. Change them to match your roles.

	The ActivityTracker module must be running in the same game (ServerScriptService); it holds the API key.
	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission.
]]

local STAFF_TAGS = { "Mod" }
local EVERYONE_TAGS = { "Player" }

local CommandAPI = require(script:FindFirstAncestor("HD Admin").Core.CommandAPI)

local function RP(): any
	local api = rawget(_G, "RoleplaySystem")
	if api then
		return api
	end
	local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
	return if module and module:IsA("ModuleScript") then (require :: any)(module) else nil
end

-- A "Player" command runs once per targeted player; only the first in a burst goes through.
local lastRun: { [number]: { [string]: number } } = {}
local function firstInBurst(userId: number, name: string): boolean
	lastRun[userId] = lastRun[userId] or {}
	local t = lastRun[userId][name]
	lastRun[userId][name] = os.clock()
	return not t or os.clock() - t > 1
end

local function run(task: CommandAPI.Task, name: string, target: Player?, text: string?)
	local caller = task.caller
	if not caller then
		return -- run by the server or from another server: there is no moderator to act as
	end
	local function show(ok: boolean, message: string, lines: { string }?)
		local body = if lines and #lines > 1 then table.concat(lines, "\n") else message
		CommandAPI.prompt(if ok then "info" else "error", caller, body, { title = "Roleplay System", duration = if lines then 15 else 6 } :: any)
	end
	if target and not firstInBurst(caller.UserId, name) then
		return show(false, "Pick one player at a time.")
	end
	local rp = RP()
	if not rp then
		return show(false, "ActivityTracker was not found in ServerScriptService.")
	end
	local ok, message, lines = rp.RunCommand(name, caller, target, text)
	show(ok, message, lines)
end

local function staff(name: string, rpName: string, withText: boolean, description: string): any
	return {
		name = name,
		args = if withText then { "Player", "UnfilteredText" } else { "Player" },
		tags = STAFF_TAGS,
		description = description,
		run = function(task: CommandAPI.Task)
			run(task, rpName, task.target, if withText then task:getArg("UnfilteredText") else nil)
		end,
	}
end

local commands: CommandAPI.Commands = {
	staff("RPInfo", "info", false, "Roleplay System: rank, callsign, departments, certifications, activity and warnings"),
	staff("RPWarn", "warn", true, "Roleplay System: log a warning in the dashboard logbook"),
	staff("RPStrike", "strike", true, "Roleplay System: log a strike in the dashboard logbook"),
	staff("RPPromote", "promote", true, "Roleplay System: promote one rank in the group"),
	staff("RPDemote", "demote", true, "Roleplay System: demote one rank in the group"),
	staff("RPBlacklist", "blacklist", true, "Roleplay System: blacklist from the group"),
	staff("RPCert", "cert", true, "Roleplay System: award or renew a certification"),
	{
		name = "Duty",
		args = { "UnfilteredText" },
		tags = EVERYONE_TAGS,
		description = "Roleplay System: go on or off duty",
		run = function(task: CommandAPI.Task)
			run(task, "duty", nil, task:getArg("UnfilteredText"))
		end,
	} :: any,
	{
		name = "OnDuty",
		args = {},
		tags = EVERYONE_TAGS,
		description = "Roleplay System: who is on duty in this server",
		run = function(task: CommandAPI.Task)
			run(task, "onduty", nil, nil)
		end,
	} :: any,
}

return commands
