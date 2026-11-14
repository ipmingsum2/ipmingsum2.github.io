--[[
	Roleplay System — Kohl's Admin addon (server only)

	Copies Kohl's Admin kicks, bans and unbans to the dashboard's Moderation log, and (optionally) shows
	dashboard announcements with Kohl's Admin's own banner. Lives next to RoleplaySystem in Config > Addons;
	"Server" in the name keeps it off clients.
]]

local USE_KOHLS_ANNOUNCEMENTS = true

return function(_K)
	local function RP()
		local api = rawget(_G, "RoleplaySystem")
		if api then
			return api
		end
		local module = game:GetService("ServerScriptService"):FindFirstChild("ActivityTracker", true)
		return if module and module:IsA("ModuleScript") then require(module) else nil
	end

	local function report(entry)
		local rp = RP()
		if rp then
			entry.source = "Kohl's Admin"
			rp.ReportModeration(entry)
		end
	end

	-- banSave = {username, reason, duration, fromUserId}; duration 0 = this server, -1 = forever, >0 = seconds
	_K.Hook.ban:Connect(function(key, banSave)
		local username, reason, duration, fromUserId = table.unpack(banSave or {})
		report({
			action = "ban",
			target = tonumber(key) or username,
			reason = reason,
			duration = if duration == -1 then -1 elseif type(duration) == "number" and duration > 0 then duration else nil,
			moderator = fromUserId,
		})
	end)
	_K.Hook.unban:Connect(function(key, banSave)
		local username = if type(banSave) == "table" then banSave[1] else nil
		report({ action = "unban", target = tonumber(key) or username })
	end)

	-- Kicks have no hook of their own, so read them from finished commands.
	_K.Hook.postCommand:Connect(function(command)
		local definition = command and command.definition
		if not definition or definition.name ~= "kick" then
			return
		end
		local targets = command.preparedArgs and command.preparedArgs[1]
		local reason = command.preparedArgs and command.preparedArgs[2]
		if typeof(targets) == "Instance" then
			targets = { targets }
		end
		if type(targets) ~= "table" then
			return
		end
		for _, target in targets do
			if typeof(target) == "Instance" and target:IsA("Player") then
				report({ action = "kick", target = target, reason = if type(reason) == "string" then reason else nil, moderator = command.from })
			end
		end
	end)

	if USE_KOHLS_ANNOUNCEMENTS then
		local rp = RP()
		if rp and rp.OnAnnouncement then
			rp.OnAnnouncement(function(title: string, message: string, from: string?)
				local function esc(s: string): string
					return (string.gsub(s, "[<>&]", { ["<"] = "&lt;", [">"] = "&gt;", ["&"] = "&amp;" }))
				end
				_K.Remote.Announce:FireAll({
					Text = ("<b>%s</b>\n%s%s"):format(esc(title), esc(message), if from then "\n— " .. esc(from) else ""),
					From = "_K",
					Duration = 15,
				})
			end)
		end
	end
end
