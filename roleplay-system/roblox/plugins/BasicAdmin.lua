--[[
	Roleplay System — Basic Admin Essentials 2.0 plugins (shared core)

	Basic Admin loads one command per ModuleScript in its Plugins folder, so the download contains nine small
	modules (rpinfo, rpwarn, rpstrike, rppromote, rpdemote, rpblacklist, rpcert, duty, onduty). This "Core"
	module sits inside "rpinfo"; the others require it. Install: right-click Basic Admin Essentials 2.0 >
	Plugins in Studio, choose "Insert from File…" and pick the downloaded .rbxmx.

	The ActivityTracker module must be running in the same game (ServerScriptService); it holds the API key.
	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission. Kicks and bans done with Basic Admin are copied to the dashboard's Moderation log.

	Levels: 0 everyone, 1 Moderator, 2 Administrator, 3 Super Administrator.
]]

local STAFF_LEVEL = 1

local Players = game:GetService("Players")

local COMMANDS = {
	rpinfo = { name = "info", level = STAFF_LEVEL, usage = "<User>", desc = "Roleplay System: rank, callsign, departments, certifications, activity and warnings.", targeted = true },
	rpwarn = { name = "warn", level = STAFF_LEVEL, usage = "<User> <Reason>", desc = "Roleplay System: log a warning in the dashboard logbook.", targeted = true },
	rpstrike = { name = "strike", level = STAFF_LEVEL, usage = "<User> <Reason>", desc = "Roleplay System: log a strike in the dashboard logbook.", targeted = true },
	rppromote = { name = "promote", level = STAFF_LEVEL, usage = "<User> [Reason]", desc = "Roleplay System: promote one rank in the group.", targeted = true },
	rpdemote = { name = "demote", level = STAFF_LEVEL, usage = "<User> [Reason]", desc = "Roleplay System: demote one rank in the group.", targeted = true },
	rpblacklist = { name = "blacklist", level = STAFF_LEVEL, usage = "<User> <Reason>", desc = "Roleplay System: blacklist from the group.", targeted = true },
	rpcert = { name = "cert", level = STAFF_LEVEL, usage = "<User> <Certification>", desc = "Roleplay System: award or renew a certification.", targeted = true },
	duty = { name = "duty", level = 0, usage = "[Label]", desc = "Roleplay System: go on or off duty." },
	onduty = { name = "onduty", level = 0, usage = "", desc = "Roleplay System: who is on duty in this server." },
}

local function RP()
	local api = rawget(_G, "RoleplaySystem")
	if api then
		return api
	end
	local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
	return if module and module:IsA("ModuleScript") then require(module) else nil
end

-- "me", an exact name, or a unique start of a name or display name. Returns (player?, ambiguous).
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

local function joinFrom(args: { string }, first: number): string
	local parts = {}
	for i = first, #args do
		table.insert(parts, args[i])
	end
	return table.concat(parts, " ")
end

-- Copies Basic Admin kicks and bans to the dashboard's Moderation log by wrapping those commands.
local MIRROR = { kick = "kick", ban = "ban", pban = "ban", pbanid = "ban", unban = "unban", unpban = "unban", unpbanid = "unban" }
local mirrored = false
local function installMirror(commands)
	if mirrored or type(commands) ~= "table" then
		return
	end
	mirrored = true
	for _, command in commands do
		local kind = type(command) == "table" and type(command[1]) == "string" and MIRROR[string.lower(command[1])]
		if kind and type(command[3]) == "function" then
			local original = command[3]
			local permanent = string.sub(string.lower(command[1]), 1, 4) == "pban"
			command[3] = function(Args, ...)
				local caller, targetText = Args[1], Args[3]
				local online = if targetText and typeof(caller) == "Instance" then (findOnline(caller, targetText)) else nil
				local results = table.pack(original(Args, ...))
				if targetText and string.lower(targetText) ~= "all" and string.lower(targetText) ~= "others" then
					task.spawn(function()
						if online and (kind == "kick" or kind == "ban") then
							task.wait(1.5)
							if online.Parent == Players then
								return -- still here: Basic Admin refused (e.g. equal or higher rank)
							end
						end
						local rp = RP()
						if rp then
							local reason = joinFrom(Args, 4)
							rp.ReportModeration({
								action = kind,
								target = online or tonumber(targetText) or targetText,
								reason = if reason ~= "" then reason else nil,
								duration = if permanent and kind == "ban" then -1 else nil,
								moderator = caller,
								source = "Basic Admin",
							})
						end
					end)
				end
				return table.unpack(results, 1, results.n)
			end
		end
	end
end

return function(commandName: string)
	local def = assert(COMMANDS[commandName], "Unknown Roleplay System command " .. tostring(commandName))
	return function(...)
		local Data = { ... }
		local remoteEvent = Data[1][1]
		local Commands = Data[1][4]
		local Prefix = Data[1][5]

		local function show(player: Player, ok: boolean, message: string, lines: { string }?)
			if lines and #lines > 1 then
				remoteEvent:FireClient(player, "Message", "Roleplay System", table.concat(lines, "\n"))
			else
				remoteEvent:FireClient(player, "Hint", if ok then "Roleplay System" else "Error", message)
			end
		end

		local function pluginFunction(Args)
			local Player = Args[1]
			local rp = RP()
			if not rp then
				return show(Player, false, "ActivityTracker was not found in ServerScriptService.")
			end
			local target, text
			if def.targeted then
				if not Args[3] then
					return show(Player, false, "Usage: " .. Prefix .. commandName .. " " .. def.usage)
				end
				local online, ambiguous = findOnline(Player, Args[3])
				if ambiguous then
					return show(Player, false, '"' .. Args[3] .. '" matches more than one player.')
				end
				target = online or Args[3]
				text = joinFrom(Args, 4)
			else
				text = joinFrom(Args, 3)
			end
			local ok, message, lines = rp.RunCommand(def.name, Player, target, text)
			show(Player, ok, message, lines)
		end

		if commandName == "rpinfo" then
			installMirror(Commands)
		end
		return commandName, pluginFunction, def.level, Prefix, { commandName, def.usage, def.desc }
	end
end
