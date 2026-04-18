---
icon: command-palette
label: Licensing API
authors:
  - name: Alvin
    link: https://github.com/ipmingsum2
    avatar: https://avatars.githubusercontent.com/u/107190717
categories:
  - Admin
visibility: private
---
!!!Admin Only Page
Only administrators can access this page. Leaking the password will result in a blacklist.
!!!

Welcome to the licensing API. In this page, you will know how to manage licensing.
The Google Apps Scripts link is `https://script.google.com/macros/s/AKfycbxO07FIU-79SYhk2F6bam6DPNI4xNmu1a9b02YMz9NSdCpS9xSkmkPhPq525mWm4KHUyQ/exec`
You should use a GET request to access the page.

---
## Parameters

### Type
=== `"add" | "remove" | "check"` 

The action to do.

===

### Product
=== `string`

The product's name.

===

### Username
=== `number`

Was actually storing usernames before, but figured out that people can change usernames, so changed to UserIds.

===

### Code
=== `"Alvin!2233aka"`

The code to authorize API requests.

===

---
## Sample Script
```lua
--// Services
local HttpService = game:GetService("HttpService")
--// Variables
local link = "https://script.google.com/macros/s/AKfycbxO07FIU-79SYhk2F6bam6DPNI4xNmu1a9b02YMz9NSdCpS9xSkmkPhPq525mWm4KHUyQ/exec"
local code = "Alvin!2233aka"
--// Functions
local function requestLicense(action, userId, prod)
	local url =
		link
		.. "?type=" .. HttpService:UrlEncode(action)
		.. "&product=" .. HttpService:UrlEncode(prod)
		.. "&code=" .. HttpService:UrlEncode(code)
		.. "&username=" .. HttpService:UrlEncode(tostring(userId))

	local result = HttpService:GetAsync(url)
	return HttpService:JSONDecode(result)
end
local function add(userId, prod)
	local decoded = requestLicense("add", userId, prod)
	if decoded.ok == true then
		print("Successfully added " .. prod .. " to " .. userId .. "!")
	else
		warn("Failed to add " .. prod .. " to " .. userId .. ".")
	end
end
local function remove(userId, prod)
	local decoded = requestLicense("remove", userId, prod)
	if decoded.ok == true then
		print("Successfully removed " .. prod .. " from " .. userId .. "!")
	else
		warn("Failed to remove " .. prod .. " from " .. userId .. ".")
	end
end
local function check(userId, prod)
	local decoded = requestLicense("check", userId, prod)
	if decoded.ok == true then
		return decoded.licensed == true
	else
		warn("Check failed for " .. prod .. " / " .. userId)
		return false
	end
end
--// Samples
local productName = "Product Name"
add(Player.UserId, productName) -- Adds a product to a user.
remove(Player.UserId, productName) -- Remove a product from a user.
local hasLicense = check(Player.UserId, productName) -- Check if a user has the product.
print(string.format("%s %s the license %s.", Player.Name, if hasLicense then "has" else "doesn't have", productName))
```
