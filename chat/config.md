# Configuring Your Chat

Need to color your chats? You got into the right place.

!!!warning
This page assumes the user has basic knowledge of the Roblox scripting language, Luau.
!!!

---

```lua
-- This script is under chat2 in the ServerScriptService folder.
local config = {}

-- Verified checkmark config

config.verified = {
	-- Verified Checkmark
	-- Format: "PlayerName";
}

return config
```

---

## Verified Badge Settings

### verified
=== `{ string }`
The usernames of people who have the verified badge.
===

---

```lua
-- This script is under chatCustoms in the ServerScriptService folder.
local config = {}

-- Chat colors config

config.rainbow = {
	-- Rainbow Messages
	-- Format: "PlayerName";
}

config.tags = {
	-- Chat Tags
	-- Format: ["PlayerName"] = "TagText";
}

return config
```

---

## Chat Settings

### rainbow
=== `{ string }`
The usernames of people who have the rainbow gradient.
===

### tags
=== `{ [string]: string }`
The usernames of people who have chat tags.
===

---

!!!success Configuration Complete!
Not working? Make sure you followed the syntax, or visit our [FAQ Page](/faq) for help, or contact Alvin Solutions Support via our [Discord server](/socials/discord) for further assistance.
!!!
