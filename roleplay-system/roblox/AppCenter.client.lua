--[[
	Application Center — client UI.
	Builds the whole interface from the applications the server fetched from the API:
	a list of open applications, then a form with one card per question.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("ApplicationCenter")
local getApplications = remotes:WaitForChild("GetApplications")
local submitApplication = remotes:WaitForChild("Submit")

local TITLE = "__TITLE__"

local C = {
	bg = Color3.fromRGB(14, 17, 22),
	panel = Color3.fromRGB(22, 26, 34),
	panel2 = Color3.fromRGB(28, 33, 43),
	line = Color3.fromRGB(52, 59, 73),
	text = Color3.fromRGB(232, 235, 241),
	dim = Color3.fromRGB(166, 174, 189),
	accent = Color3.fromRGB(91, 141, 239),
	good = Color3.fromRGB(47, 165, 138),
	bad = Color3.fromRGB(229, 96, 106),
}

local function make(class, props, parent)
	local inst = Instance.new(class)
	for key, value in props do
		inst[key] = value
	end
	inst.Parent = parent
	return inst
end

local function corner(parent, radius)
	make("UICorner", { CornerRadius = UDim.new(0, radius or 8) }, parent)
end

local function padding(parent, px)
	make("UIPadding", {
		PaddingTop = UDim.new(0, px), PaddingBottom = UDim.new(0, px),
		PaddingLeft = UDim.new(0, px), PaddingRight = UDim.new(0, px),
	}, parent)
end

local function list(parent, gap)
	return make("UIListLayout", { Padding = UDim.new(0, gap or 8), SortOrder = Enum.SortOrder.LayoutOrder }, parent)
end

local function label(parent, text, size, color, bold)
	return make("TextLabel", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham,
		Text = text,
		TextSize = size,
		TextColor3 = color or C.text,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
	}, parent)
end

local function button(parent, text, color)
	local b = make("TextButton", {
		BackgroundColor3 = color or C.panel2,
		Size = UDim2.new(1, 0, 0, 40),
		AutoButtonColor = true,
		Font = Enum.Font.GothamMedium,
		Text = text,
		TextSize = 16,
		TextColor3 = C.text,
		TextWrapped = true,
	}, parent)
	corner(b)
	return b
end

-- ---------- frame ----------
local gui = make("ScreenGui", { Name = "ApplicationCenter", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, player:WaitForChild("PlayerGui"))
local background = make("Frame", { BackgroundColor3 = C.bg, Size = UDim2.fromScale(1, 1), BorderSizePixel = 0 }, gui)
local shell = make("Frame", {
	BackgroundTransparency = 1,
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.new(0.92, 0, 0.88, 0),
}, background)
make("UISizeConstraint", { MaxSize = Vector2.new(760, 2000) }, shell)

local header = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 64) }, shell)
local titleLabel = make("TextLabel", {
	BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 34), Font = Enum.Font.GothamBold, TextSize = 26,
	TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left, Text = TITLE, TextTruncate = Enum.TextTruncate.AtEnd,
}, header)
local subtitleLabel = make("TextLabel", {
	BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 36), Size = UDim2.new(1, 0, 0, 22), Font = Enum.Font.Gotham, TextSize = 16,
	TextColor3 = C.dim, TextXAlignment = Enum.TextXAlignment.Left, Text = "Application center", TextTruncate = Enum.TextTruncate.AtEnd,
}, header)

local content = make("ScrollingFrame", {
	BackgroundTransparency = 1, BorderSizePixel = 0,
	Position = UDim2.fromOffset(0, 74), Size = UDim2.new(1, 0, 1, -140),
	CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	ScrollBarThickness = 6, ScrollBarImageColor3 = C.line, ScrollingDirection = Enum.ScrollingDirection.Y,
}, shell)
list(content, 12)
make("UIPadding", { PaddingRight = UDim.new(0, 10) }, content)

local footer = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.new(1, 0, 0, 56) }, shell)
local statusLabel = make("TextLabel", {
	BackgroundTransparency = 1, Size = UDim2.new(1, -330, 1, 0), Font = Enum.Font.Gotham, TextSize = 15, TextColor3 = C.dim,
	TextXAlignment = Enum.TextXAlignment.Left, TextWrapped = true, Text = "",
}, footer)
local backButton = button(footer, "Back")
backButton.AnchorPoint = Vector2.new(1, 0.5)
backButton.Position = UDim2.new(1, -170, 0.5, 0)
backButton.Size = UDim2.fromOffset(150, 42)
local submitButton = button(footer, "Submit", C.accent)
submitButton.AnchorPoint = Vector2.new(1, 0.5)
submitButton.Position = UDim2.new(1, 0, 0.5, 0)
submitButton.Size = UDim2.fromOffset(160, 42)

local function setStatus(text, color)
	statusLabel.Text = text or ""
	statusLabel.TextColor3 = color or C.dim
end

local function clearContent()
	for _, child in content:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
	content.CanvasPosition = Vector2.zero
end

local function card(order)
	local frame = make("Frame", { BackgroundColor3 = C.panel, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = order or 0 }, content)
	corner(frame, 10)
	padding(frame, 16)
	list(frame, 8)
	return frame
end

-- ---------- question inputs ----------
local OTHER = "__other__" -- sent when "Other" is picked but nothing typed; the API answers with a clear error

local function trim(text: string): string
	return (string.gsub(text, "^%s*(.-)%s*$", "%1"))
end

local function shuffled(list)
	local copy = table.clone(list)
	for i = #copy, 2, -1 do
		local j = math.random(i)
		copy[i], copy[j] = copy[j], copy[i]
	end
	return copy
end

local function textInput(parent, multiline, numeric, onChange, placeholder)
	local box = make("TextBox", {
		BackgroundColor3 = C.bg, Size = UDim2.new(1, 0, 0, multiline and 110 or 40),
		Font = Enum.Font.Gotham, TextSize = 16, TextColor3 = C.text, PlaceholderColor3 = C.dim,
		PlaceholderText = placeholder or (numeric and "Enter a number" or "Your answer"), Text = "", ClearTextOnFocus = false,
		MultiLine = multiline, TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = multiline and Enum.TextYAlignment.Top or Enum.TextYAlignment.Center,
	}, parent)
	corner(box)
	padding(box, 10)
	make("UIStroke", { Color = C.line, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, box)
	box:GetPropertyChangedSignal("Text"):Connect(function()
		if numeric then
			onChange(tonumber(box.Text))
		else
			onChange(box.Text)
		end
	end)
	return box
end

-- Option buttons: single choice replaces the selection, multi toggles each option.
-- allowOther adds an "Other" button with a text box for the player's own answer.
local function optionGroup(parent, options, multi, horizontal, onChange, allowOther)
	local holder = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
	if horizontal then
		make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 6), Wraps = true, SortOrder = Enum.SortOrder.LayoutOrder }, holder)
	else
		list(holder, 6)
	end
	local selected = {}
	local buttons = {}
	local otherBox: TextBox? = nil
	local function refresh()
		for option, b in buttons do
			b.BackgroundColor3 = selected[option] and C.accent or C.panel2
		end
		if otherBox then
			otherBox.Visible = selected[OTHER] == true
		end
		local otherText = if otherBox then trim(otherBox.Text) else ""
		local otherValue = if otherText ~= "" then otherText else OTHER
		if multi then
			local values = {}
			for _, option in options do
				if selected[option] then
					table.insert(values, option)
				end
			end
			if selected[OTHER] then
				table.insert(values, otherValue)
			end
			onChange(values)
		else
			local value = nil
			for _, option in options do
				if selected[option] then
					value = option
				end
			end
			if selected[OTHER] then
				value = otherValue
			end
			onChange(value)
		end
	end
	local all = table.clone(options)
	if allowOther then
		table.insert(all, OTHER)
	end
	for index, option in all do
		local b = button(holder, if option == OTHER then "Other…" else tostring(option))
		b.LayoutOrder = index
		if horizontal then
			b.Size = UDim2.fromOffset(52, 40)
		else
			b.TextXAlignment = Enum.TextXAlignment.Left
			padding(b, 10)
			b.AutomaticSize = Enum.AutomaticSize.Y
		end
		buttons[option] = b
		b.Activated:Connect(function()
			if multi then
				selected[option] = not selected[option] or nil
			else
				local was = selected[option]
				table.clear(selected)
				selected[option] = not was or nil
			end
			refresh()
		end)
	end
	if allowOther then
		otherBox = textInput(holder, false, false, function()
			refresh()
		end, "Type your answer")
		otherBox.LayoutOrder = #all + 1
		otherBox.Visible = false
	end
end

-- ---------- views ----------
local showList

local function showResult(ok, message)
	clearContent()
	subtitleLabel.Text = ok and "Submitted" or "Something went wrong"
	local c = card()
	label(c, ok and "Thank you!" or "Not submitted", 22, ok and C.good or C.bad, true)
	label(c, message, 17, C.text)
	submitButton.Visible = false
	backButton.Visible = true
	setStatus("")
end

local function showForm(application)
	clearContent()
	titleLabel.Text = application.title
	subtitleLabel.Text = "Applying as " .. player.Name
	backButton.Visible = true
	submitButton.Visible = true
	submitButton.Text = "Submit"
	setStatus("")

	local answers = {}
	if application.description and application.description ~= "" then
		local intro = card(0)
		label(intro, application.description, 16, C.dim)
	end

	for index, question in application.questions do
		if question.type == "section" then
			local section = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = index }, content)
			list(section, 2)
			label(section, question.label, 20, C.text, true)
			if question.description and question.description ~= "" then
				label(section, question.description, 15, C.dim)
			end
			continue
		end

		local c = card(index)
		label(c, question.label .. (question.required and "  *" or ""), 17, C.text, true)
		if question.description and question.description ~= "" then
			label(c, question.description, 14, C.dim)
		end
		local function set(value)
			answers[question.id] = value
		end

		if question.type == "short" then
			textInput(c, false, false, set)
		elseif question.type == "paragraph" then
			textInput(c, true, false, set)
		elseif question.type == "number" then
			textInput(c, false, true, set)
		elseif question.type == "choice" or question.type == "dropdown" then
			local options = question.options or {}
			optionGroup(c, if question.shuffle then shuffled(options) else options, false, false, set, question.type == "choice" and question.other)
		elseif question.type == "checkboxes" then
			local options = question.options or {}
			optionGroup(c, if question.shuffle then shuffled(options) else options, true, false, set, question.other)
		elseif question.type == "date" then
			textInput(c, false, false, function(text)
				set(trim(text))
			end, "YYYY-MM-DD, e.g. 2026-11-30")
		elseif question.type == "time" then
			textInput(c, false, false, function(text)
				set(trim(text))
			end, "HH:MM (24-hour), e.g. 18:30")
		elseif question.type == "yesno" then
			optionGroup(c, { "Yes", "No" }, false, true, set)
		elseif question.type == "scale" then
			local steps = {}
			for value = question.min or 1, question.max or 5 do
				table.insert(steps, value)
			end
			optionGroup(c, steps, false, true, set)
			if (question.minLabel and question.minLabel ~= "") or (question.maxLabel and question.maxLabel ~= "") then
				label(c, ("%d = %s   ·   %d = %s"):format(question.min or 1, question.minLabel or "", question.max or 5, question.maxLabel or ""), 14, C.dim)
			end
		end
	end

	local busy = false
	local connection
	connection = submitButton.Activated:Connect(function()
		if busy then
			return
		end
		-- Catch missing required answers here so the player sees which question it is.
		for _, question in application.questions do
			local value = answers[question.id]
			local empty = value == nil or value == "" or (type(value) == "table" and #value == 0)
			if question.required and empty then
				setStatus('Please answer: "' .. question.label .. '"', C.bad)
				return
			end
		end
		busy = true
		submitButton.Text = "Submitting…"
		setStatus("")
		local ok, result = pcall(function()
			return submitApplication:InvokeServer(application.id, answers)
		end)
		busy = false
		submitButton.Text = "Submit"
		if not ok or type(result) ~= "table" then
			setStatus("Could not reach the server. Please try again.", C.bad)
			return
		end
		if result.ok then
			connection:Disconnect()
			showResult(true, result.message)
		else
			setStatus(result.error or "Your application could not be submitted.", C.bad)
		end
	end)
	backButton.Activated:Once(function()
		connection:Disconnect()
		showList()
	end)
end

function showList()
	clearContent()
	titleLabel.Text = TITLE
	subtitleLabel.Text = "Application center"
	backButton.Visible = false
	submitButton.Visible = false
	setStatus("Loading applications…")

	local ok, result = pcall(function()
		return getApplications:InvokeServer()
	end)
	if not ok or type(result) ~= "table" or not result.ok then
		setStatus("")
		local c = card()
		label(c, "Could not load applications", 20, C.bad, true)
		label(c, (type(result) == "table" and result.error) or "Please try again in a moment.", 16, C.dim)
		local retry = button(c, "Try again", C.accent)
		retry.Activated:Once(showList)
		return
	end

	setStatus("")
	if result.group and result.group ~= "" then
		titleLabel.Text = result.group
	end
	if #result.applications == 0 then
		local c = card()
		label(c, "No open applications", 20, C.text, true)
		label(c, "There is nothing to apply for right now. Check back later.", 16, C.dim)
		local retry = button(c, "Refresh")
		retry.Activated:Once(showList)
		return
	end
	for index, application in result.applications do
		local c = card(index)
		label(c, application.title, 20, C.text, true)
		if application.description and application.description ~= "" then
			label(c, application.description, 15, C.dim)
		end
		local count = 0
		for _, question in application.questions do
			if question.type ~= "section" then
				count += 1
			end
		end
		label(c, count .. (count == 1 and " question" or " questions"), 14, C.dim)
		local apply = button(c, "Apply", C.accent)
		apply.Activated:Connect(function()
			showForm(application)
		end)
	end
end

showList()
