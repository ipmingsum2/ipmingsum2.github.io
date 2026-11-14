--[[
	Roleplay System — Kohl's Admin Infinite (legacy) custom commands

	Works with Kohl's Admin Infinite and with the new Kohl's Admin's Legacy loader (which also imports legacy
	custom commands into the modern loader).

	Install:
	  1. Right-click your Custom_Commands module (new Kohl's Admin: Config > Legacy > Custom_Commands) in
	     Studio, choose "Insert from File…" and pick the downloaded .rbxmx. This ModuleScript
	     ("RoleplaySystem") ends up inside Custom_Commands.
	  2. In Custom_Commands, store the returned table in a variable and add the commands before returning it:

	         local commands = {
	             -- your existing commands
	         }
	         for _, command in require(script.RoleplaySystem) do table.insert(commands, command) end
	         return commands

	The ActivityTracker module must be running in the same game (ServerScriptService); it holds the API key.
	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission. Powers: 0 Player, 1 VIP, 2 Moderator, 3 Administrator, 4 SuperAdmin, 5 Owner, 6 Game Creator.
]]

local STAFF_POWER = 2

local Players = game:GetService("Players")

local function RP()
	local api = rawget(_G, "RoleplaySystem")
	if api then
		return api
	end
	local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
	return if module and module:IsA("ModuleScript") then require(module) else nil
end

local function findOnline(caller: Player, text: string): (Player?, boolean)
	text = string.lower(text)
	if text == "me" then
		return caller, false
	end
	local match
	for _, p in Players:GetPlayers() do
		local n, d = string.lower(p.Name), string.lower(p.DisplayName)
		if n == text or d == text then
			return p, false
		end
		if string.sub(n, 1, #text) == text or string.sub(d, 1, #text) == text then
			if match then
				return nil, true
			end
			match = p
		end
	end
	return match, false
end

local function run(name: string, targeted: boolean, caller: Player, raw: string?)
	local rp = RP()
	if not rp then
		warn("[Roleplay System] ActivityTracker was not found in ServerScriptService.")
		return
	end
	local function show(ok: boolean, message: string, lines: { string }?)
		rp.Notify(caller, if ok then "Roleplay System" else "Roleplay System — error", if lines and #lines > 1 then table.concat(lines, "\n") else message, if lines then 15 else 6)
	end
	raw = raw or ""
	local target, text = nil, raw
	if targeted then
		-- One string argument holds "<player> <rest>" so reasons keep their spaces.
		local first, rest = string.match(raw, "^%s*(%S+)%s*(.*)$")
		if not first then
			return show(false, "Name a player.")
		end
		local online, ambiguous = findOnline(caller, first)
		if ambiguous then
			return show(false, '"' .. first .. '" matches more than one player.')
		end
		target, text = online or first, rest
	end
	local ok, message, lines = rp.RunCommand(name, caller, target, text)
	show(ok, message, lines)
end

local function command(aliases: { string }, description: string, example: string, power: number, rpName: string, targeted: boolean)
	return {
		aliases,
		{ description, example },
		power,
		{ "string/" },
		function(pl, args)
			run(rpName, targeted, pl, args[1])
		end,
	}
end

return {
	command({ "rpinfo" }, "Roleplay System: rank, callsign, departments, certifications, activity and warnings.", "rpinfo Builderman", STAFF_POWER, "info", true),
	command({ "rpwarn" }, "Roleplay System: log a warning in the dashboard logbook.", "rpwarn Builderman Ignoring orders", STAFF_POWER, "warn", true),
	command({ "rpstrike" }, "Roleplay System: log a strike in the dashboard logbook.", "rpstrike Builderman Abusing tools", STAFF_POWER, "strike", true),
	command({ "rppromote" }, "Roleplay System: promote one rank in the group.", "rppromote Builderman Passed training", STAFF_POWER, "promote", true),
	command({ "rpdemote" }, "Roleplay System: demote one rank in the group.", "rpdemote Builderman Inactivity", STAFF_POWER, "demote", true),
	command({ "rpblacklist" }, "Roleplay System: blacklist from the group.", "rpblacklist Builderman Exploiting", STAFF_POWER, "blacklist", true),
	command({ "rpcert" }, "Roleplay System: award or renew a certification.", "rpcert Builderman Firearms", STAFF_POWER, "cert", true),
	command({ "duty" }, "Roleplay System: go on or off duty.", "duty Patrol", 0, "duty", false),
	command({ "onduty" }, "Roleplay System: who is on duty in this server.", "onduty", 0, "onduty", false),
}
