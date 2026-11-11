--[[ Verification game — client UI: one code box and a button. ]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local verifyCode = ReplicatedStorage:WaitForChild("VerifyCode")

local TITLE = "__TITLE__"

local BG = Color3.fromRGB(14, 17, 22)
local PANEL = Color3.fromRGB(22, 26, 34)
local LINE = Color3.fromRGB(52, 59, 73)
local TEXT = Color3.fromRGB(232, 235, 241)
local DIM = Color3.fromRGB(166, 174, 189)
local ACCENT = Color3.fromRGB(91, 141, 239)
local GOOD = Color3.fromRGB(47, 165, 138)
local BAD = Color3.fromRGB(229, 96, 106)

local function make(class, props, parent)
	local inst = Instance.new(class)
	for key, value in props do
		inst[key] = value
	end
	inst.Parent = parent
	return inst
end

local gui = make("ScreenGui", { Name = "Verify", ResetOnSpawn = false, IgnoreGuiInset = true }, player:WaitForChild("PlayerGui"))
local background = make("Frame", { BackgroundColor3 = BG, Size = UDim2.fromScale(1, 1), BorderSizePixel = 0 }, gui)
local card = make("Frame", {
	BackgroundColor3 = PANEL, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.new(0.9, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y,
}, background)
make("UISizeConstraint", { MaxSize = Vector2.new(460, 1000) }, card)
make("UICorner", { CornerRadius = UDim.new(0, 12) }, card)
make("UIPadding", { PaddingTop = UDim.new(0, 24), PaddingBottom = UDim.new(0, 24), PaddingLeft = UDim.new(0, 24), PaddingRight = UDim.new(0, 24) }, card)
make("UIListLayout", { Padding = UDim.new(0, 12), SortOrder = Enum.SortOrder.LayoutOrder }, card)

local function text(order, value, size, color, font)
	return make("TextLabel", {
		BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = order,
		Font = font or Enum.Font.Gotham, Text = value, TextSize = size, TextColor3 = color, TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, card)
end

text(1, TITLE, 24, TEXT, Enum.Font.GothamBold)
text(2, "Link your Roblox account. Enter the 6-character code shown on the Verify page. You are signed in as " .. player.Name .. ".", 16, DIM)

local box = make("TextBox", {
	BackgroundColor3 = BG, Size = UDim2.new(1, 0, 0, 56), LayoutOrder = 3, Font = Enum.Font.Code, TextSize = 30,
	TextColor3 = TEXT, PlaceholderText = "CODE", PlaceholderColor3 = LINE, Text = "", ClearTextOnFocus = false,
}, card)
make("UICorner", { CornerRadius = UDim.new(0, 8) }, box)
make("UIStroke", { Color = LINE, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, box)

local submit = make("TextButton", {
	BackgroundColor3 = ACCENT, Size = UDim2.new(1, 0, 0, 46), LayoutOrder = 4, Font = Enum.Font.GothamBold, TextSize = 18,
	TextColor3 = Color3.new(1, 1, 1), Text = "Link account",
}, card)
make("UICorner", { CornerRadius = UDim.new(0, 8) }, submit)

local status = text(5, "", 16, DIM)

box:GetPropertyChangedSignal("Text"):Connect(function()
	local cleaned = string.sub(string.upper(string.gsub(box.Text, "[^%w]", "")), 1, 8)
	if cleaned ~= box.Text then
		box.Text = cleaned
	end
end)

local busy = false
local function send()
	if busy or box.Text == "" then
		return
	end
	busy = true
	submit.Text = "Checking…"
	local ok, result = pcall(function()
		return verifyCode:InvokeServer(box.Text)
	end)
	busy = false
	submit.Text = "Link account"
	if not ok or type(result) ~= "table" then
		status.Text = "Could not reach the server. Please try again."
		status.TextColor3 = BAD
		return
	end
	status.Text = result.message or ""
	status.TextColor3 = result.ok and GOOD or BAD
	if result.ok then
		box.Text = ""
	end
end

submit.Activated:Connect(send)
box.FocusLost:Connect(function(enterPressed)
	if enterPressed then
		send()
	end
end)
