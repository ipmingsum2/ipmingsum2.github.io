--[[
	Roleplay System — Adonis plugin

	Install: put this ModuleScript in Adonis_Loader > Config > Plugins and keep its name "Server-RoleplaySystem"
	(Adonis only loads server plugins whose names start with "Server-"). The ActivityTracker module must be
	running in the same game (ServerScriptService), because it holds the API key.

	Commands (prefix from your Adonis settings):
	  rpinfo <player>                 roster profile: rank, callsign, departments, certifications, week, warnings
	  rpwarn <player> <reason>        log a warning in the dashboard logbook
	  rpstrike <player> <reason>      log a strike
	  rppromote <player> [reason]     promote one rank in the Roblox group
	  rpdemote <player> [reason]      demote one rank
	  rpblacklist <player> <reason>   blacklist from the group (kicked from every server)
	  rpcert <player> <certification> award or renew a certification
	  duty [label]                    go on / off duty (everyone)
	  onduty                          who is on duty in this server (everyone)

	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission. Adonis kicks, bans, unbans and warnings are copied to the dashboard's Moderation log.
]]

local ADMIN_LEVEL = "Moderators" -- who sees the staff commands; the dashboard still checks permissions
local USE_ADONIS_ANNOUNCEMENTS = true -- show dashboard announcements with Adonis' notification instead of the built-in banner

return function(Vargs)
	local server, service = Vargs.Server, Vargs.Service
	local Players = game:GetService("Players")

	local function RP()
		local api = rawget(_G, "RoleplaySystem")
		if api then
			return api
		end
		local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
		return if module and module:IsA("ModuleScript") then require(module) else nil
	end

	local function reply(plr: Player, ok: boolean, message: string, lines: { string }?)
		if lines and #lines > 1 then
			server.Remote.MakeGui(plr, "List", { Title = "Roleplay System", Tab = lines })
		elseif ok then
			server.Functions.Hint(message, { plr })
		else
			server.Functions.Hint("Roleplay System: " .. message, { plr })
		end
	end

	local function run(name: string, plr: Player, target: any, text: string?)
		local rp = RP()
		if not rp then
			return reply(plr, false, "ActivityTracker was not found in ServerScriptService.")
		end
		local ok, message, lines = rp.RunCommand(name, plr, target, text)
		reply(plr, ok, message, lines)
	end

	local COMMANDS = {
		{ key = "Info", cmd = "rpinfo", name = "info", args = { "player" }, level = ADMIN_LEVEL, desc = "Roleplay System: a player's rank, callsign, departments, certifications, activity and warnings" },
		{ key = "Warn", cmd = "rpwarn", name = "warn", args = { "player", "reason" }, level = ADMIN_LEVEL, desc = "Roleplay System: log a warning in the dashboard logbook" },
		{ key = "Strike", cmd = "rpstrike", name = "strike", args = { "player", "reason" }, level = ADMIN_LEVEL, desc = "Roleplay System: log a strike in the dashboard logbook" },
		{ key = "Promote", cmd = "rppromote", name = "promote", args = { "player", "reason (optional)" }, level = ADMIN_LEVEL, desc = "Roleplay System: promote one rank in the group" },
		{ key = "Demote", cmd = "rpdemote", name = "demote", args = { "player", "reason (optional)" }, level = ADMIN_LEVEL, desc = "Roleplay System: demote one rank in the group" },
		{ key = "Blacklist", cmd = "rpblacklist", name = "blacklist", args = { "player", "reason" }, level = ADMIN_LEVEL, desc = "Roleplay System: blacklist from the group" },
		{ key = "Cert", cmd = "rpcert", name = "cert", args = { "player", "certification" }, level = ADMIN_LEVEL, desc = "Roleplay System: award or renew a certification" },
		{ key = "Duty", cmd = "duty", name = "duty", args = { "label (optional)" }, level = "Players", desc = "Roleplay System: go on or off duty" },
		{ key = "OnDuty", cmd = "onduty", name = "onduty", args = {}, level = "Players", desc = "Roleplay System: who is on duty in this server" },
	}

	for _, def in COMMANDS do
		local targeted = def.args[1] == "player"
		server.Commands["RoleplaySystem" .. def.key] = {
			Prefix = server.Settings.Prefix,
			Commands = { def.cmd },
			Args = def.args,
			Description = def.desc,
			Category = "Roleplay System",
			Hidden = false,
			Fun = false,
			AdminLevel = def.level,
			Function = function(plr: Player, args: { string })
				if not targeted then
					return run(def.name, plr, nil, args[1])
				end
				local targets = service.GetPlayers(plr, assert(args[1], "Missing target player (argument #1)"), { UseFakePlayer = true })
				if #targets ~= 1 then
					return reply(plr, false, "Pick exactly one player.")
				end
				local target = targets[1]
				local id = tonumber(target.UserId)
				run(def.name, plr, if id and id > 0 then id else target.Name, args[2])
			end,
		}
	end

	-- Copy Adonis moderation actions to the dashboard's Moderation log.
	local MIRROR = {
		["Kick"] = "kick", ["Kick Warning"] = "kick", ["Warned"] = "warn",
		["Server Ban"] = "ban", ["Time Ban"] = "ban", ["Direct Time Ban"] = "ban", ["Permanent Ban"] = "ban",
		["Unban"] = "unban", ["Unbanned"] = "unban", ["Un-Time Ban"] = "unban",
	}
	local original = server.Functions.LogAdminAction
	server.Functions.LogAdminAction = function(plr, action, targetName, details, ...)
		local kind = MIRROR[action]
		local rp = kind and RP()
		if rp and targetName then
			local reason = tostring(details or "")
			reason = string.gsub(reason, "^Reason:%s*", "")
			rp.ReportModeration({
				action = kind,
				target = Players:FindFirstChild(tostring(targetName)) or targetName,
				reason = if reason ~= "" and reason ~= "No reason provided" then reason else nil,
				duration = if action == "Permanent Ban" then -1 else nil,
				moderator = plr,
				source = "Adonis",
			})
		end
		if original then
			return original(plr, action, targetName, details, ...)
		end
	end

	if USE_ADONIS_ANNOUNCEMENTS then
		local rp = RP()
		if rp and rp.OnAnnouncement then
			rp.OnAnnouncement(function(title: string, message: string, from: string?)
				server.Functions.Notification(title, if from then message .. "\n— " .. from else message, Players:GetPlayers(), 15)
			end)
		end
	end
end
