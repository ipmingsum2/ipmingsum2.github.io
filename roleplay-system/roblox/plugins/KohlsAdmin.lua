--[[
	Roleplay System — Kohl's Admin addon (commands)

	Install: right-click Kohl's Admin > Config > Addons in Studio, choose "Insert from File…" and pick the
	downloaded .rbxmx. It adds two ModuleScripts:
	  RoleplaySystem        the commands (shared: Kohl's Admin registers commands on server and client)
	  RoleplaySystemServer  copies Kohl's Admin kicks, bans and unbans to the dashboard's Moderation log

	Groups decide who can use the commands: "Moderation" (mod and up by default) and "Utility" (everyone).
	The ActivityTracker module must be running in the same game (ServerScriptService); it holds the API key.
	Staff commands act as the moderator's linked dashboard account, so they also need the matching dashboard
	permission. Nothing secret is in this module, so it is fine that clients can see it.
]]

local STAFF_GROUP = "Moderation"
local EVERYONE_GROUP = "Utility"

return function(_K)
	local function RP()
		local api = rawget(_G, "RoleplaySystem")
		if api then
			return api
		end
		local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
		return if module and module:IsA("ModuleScript") then require(module) else nil
	end

	local function escape(s: string): string
		return (string.gsub(s, "[<>&]", { ["<"] = "&lt;", [">"] = "&gt;", ["&"] = "&amp;" }))
	end

	-- Returns nil on success (after a notice) or an error string, which Kohl's Admin shows to the caller.
	local function run(context, name: string, target: any, text: string?): string?
		local caller = context.fromPlayer
		if not caller then
			return "Run this command from inside the game."
		end
		local rp = RP()
		if not rp then
			return "ActivityTracker was not found in ServerScriptService."
		end
		local ok, message, lines = rp.RunCommand(name, caller, target, text)
		if not ok then
			return "Roleplay System: " .. message
		end
		local body = if lines and #lines > 1 then table.concat(lines, "\n") else message
		_K.Remote.Notify:Fire(caller, {
			Text = "<b>Roleplay System</b>\n" .. escape(body),
			From = "_K",
			Duration = if lines then 15 else 6,
		})
		return nil
	end

	local function staff(cmd: string, rpName: string, textName: string?, description: string)
		local args = {
			{ type = "userId", name = "Player", description = "The player (online, or a user ID)." },
		}
		if textName then
			table.insert(args, { type = "rawString", name = textName, description = textName .. " (stored in the dashboard).", optional = rpName == "promote" or rpName == "demote" })
		end
		_K.Registry.registerCommand(_K, {
			name = cmd,
			description = description,
			group = STAFF_GROUP,
			args = args,
			run = function(context, userId: number, text: string?)
				return run(context, rpName, userId, text)
			end,
		})
	end

	staff("rpinfo", "info", nil, "Roleplay System: rank, callsign, departments, certifications, activity and warnings.")
	staff("rpwarn", "warn", "Reason", "Roleplay System: log a warning in the dashboard logbook.")
	staff("rpstrike", "strike", "Reason", "Roleplay System: log a strike in the dashboard logbook.")
	staff("rppromote", "promote", "Reason", "Roleplay System: promote one rank in the group.")
	staff("rpdemote", "demote", "Reason", "Roleplay System: demote one rank in the group.")
	staff("rpblacklist", "blacklist", "Reason", "Roleplay System: blacklist from the group.")
	staff("rpcert", "cert", "Certification", "Roleplay System: award or renew a certification.")

	_K.Registry.registerCommand(_K, {
		name = "duty",
		description = "Roleplay System: go on or off duty.",
		group = EVERYONE_GROUP,
		args = { { type = "rawString", name = "Label", description = "Optional: department or unit.", optional = true } },
		run = function(context, label: string?)
			return run(context, "duty", nil, label)
		end,
	})
	_K.Registry.registerCommand(_K, {
		name = "onduty",
		description = "Roleplay System: who is on duty in this server.",
		group = EVERYONE_GROUP,
		args = {},
		run = function(context)
			return run(context, "onduty", nil, nil)
		end,
	})
end
