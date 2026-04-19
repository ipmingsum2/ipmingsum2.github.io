---
icon: tools
label: Configuration
authors:
  - name: Alvin
    link: https://github.com/ipmingsum2
    avatar: https://avatars.githubusercontent.com/u/107190717
order: 2
---
# Configuring Your Ad Board

Need your ads switch faster? Yes, we have that.

!!!warning
This page assumes the user has basic knowledge of the Roblox scripting language, Luau.
!!!

---

```lua
local settings = {}
-- Configure your settings here!

settings.waitTime = 5 -- Wait how many seconds until next ad?

settings.adAssets = {
	"rbxassetid://84859048110942", -- Placeholder
	"rbxassetid://84859048110942", -- Placeholder
	-- Put your ad asset IDs here, in that format.
}

settings.powerButtonWhitelistUsers = {
	5639926516, -- Alvinofelephants
	-- Put userids of people that can click the power button
}

settings.powerButtonWhitelistGroups = {
	[0] = 0,
	-- Put groupids and the minimum rank they can be to use the power button here
}

function settings:allow(Player:Player)
	-- We will not provide support for modifying this function.
	for _, id in pairs(settings.powerButtonWhitelistUsers) do
		if Player.UserId == id then
			return true
		end
	end
	for group,rank in pairs(settings.powerButtonWhitelistGroups) do
		if Player:GetRankInGroupAsync(group) >= rank then
			return true
		end
	end
	return false
end


return settings
```

---

## General Settings

### waitTime
=== `number`
After `waitTime`, the ads will switch.
===

---

### adAssets
=== `{ string }`
The asset ids of the image.
===

---

### powerButtonWhitelistUsers
=== `{ number }`
The users that are able to click the power button.
===

---

### powerButtonWhitelistGroups
=== `{ [number]: number }`
The groups and their minimum ranks that are able to click the power button.
===

---

### allow
=== `function`
The check used to detect if the user is allowed to press the power button.
===

---

!!!success Configuration Complete!
Not working? Make sure you followed the syntax, or visit our [FAQ Page](/faq) for help, or contact Alvin Solutions Support via our [Discord server](/socials/discord) for further assistance.
!!!
