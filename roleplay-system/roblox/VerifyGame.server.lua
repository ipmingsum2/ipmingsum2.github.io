--[[
	Verification game — server.
	Players get a code on the Verify web page (after signing in with Discord, or from
	"My account" in the dashboard) and type it here. This Script sends the code together
	with the player's real UserId to the API, which links the two accounts.

	Keep this Script in ServerScriptService: it holds the API key.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local API_URL = "__API_URL__"
local API_KEY = "__API_KEY__"
local COOLDOWN = 4

local verifyCode = Instance.new("RemoteFunction")
verifyCode.Name = "VerifyCode"
verifyCode.Parent = ReplicatedStorage

local lastAttempt = {}

verifyCode.OnServerInvoke = function(player, code)
	if type(code) ~= "string" then
		return { ok = false, message = "Enter the code from the Verify page." }
	end
	code = string.upper(string.gsub(code, "[^%w]", ""))
	if #code < 4 or #code > 12 then
		return { ok = false, message = "That does not look like a valid code." }
	end
	local now = os.clock()
	if lastAttempt[player] and now - lastAttempt[player] < COOLDOWN then
		return { ok = false, message = "Please wait a moment before trying again." }
	end
	lastAttempt[player] = now

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = API_URL .. "/v1/game/verify",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json", ["X-Api-Key"] = API_KEY },
			-- UserId and Name come from the server, so a client cannot verify as someone else.
			Body = HttpService:JSONEncode({ code = code, userId = player.UserId, username = player.Name }),
		})
	end)
	if not ok then
		warn("[Verify] request failed:", response)
		return { ok = false, message = "Could not reach the verification server. Try again shortly." }
	end
	local decoded, data = pcall(HttpService.JSONDecode, HttpService, response.Body)
	if not decoded or type(data) ~= "table" then
		data = {}
	end
	if response.Success and data.ok then
		local who = data.discordName and (" to Discord account " .. data.discordName) or ""
		return { ok = true, message = "Linked " .. player.Name .. who .. ". You can leave the game now." }
	end
	return { ok = false, message = data.error or "That code is invalid or has expired." }
end

Players.PlayerRemoving:Connect(function(player)
	lastAttempt[player] = nil
end)
