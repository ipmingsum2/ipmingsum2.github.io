!!!Admin Only Page
Only administrators can access this page. Leaking the password will result in a blacklist.
!!!

Welcome to the licensing API. In this page, you will know how to manage licensing.
This page is very simple. Just paste the ModuleScript in **ServerStorage** and require it.

---
## Module
```lua
--!nonstrict

--// Put this in ServerStorage
local HttpService = game:GetService("HttpService")

local LicenseClient = {}
LicenseClient.__index = LicenseClient

export type Client = {
	Endpoint: string,
	Password: string,
	CheckLicense: (self: Client, productid: string, userid: string) -> boolean,
	AddLicense: (self: Client, productid: string, userid: string) -> any,
	RemoveLicense: (self: Client, productid: string, userid: string) -> any,
	CreateProduct: (self: Client, productid: string) -> any,
	DeleteProduct: (self: Client, productid: string) -> any,
	RenameProduct: (self: Client, productid: string, newproductid: string) -> any,
	GetProducts: (self: Client) -> { string },
}

function LicenseClient.new(endpoint: string, password: string): Client
	local self = setmetatable({}, LicenseClient)
	self.Endpoint = LicenseClient._normalizeEndpoint(endpoint)
	self.Password = password
	return self
end

function LicenseClient._normalizeEndpoint(endpoint: string): string
	endpoint = endpoint:gsub("/+$", "")

	if endpoint:find("/functions/v1/", 1, true) then
		return endpoint
	end

	if endpoint:match("^https://[^/]+%.functions%.supabase%.co/") then
		return endpoint
	end

	if endpoint:match("^https://[^/]+%.supabase%.co$") then
		return endpoint .. "/functions/v1/license-handler"
	end

	if endpoint:match("^https://[^/]+%.supabase%.co/license%-handler$") then
		return endpoint:gsub("/license%-handler$", "/functions/v1/license-handler")
	end

	return endpoint
end

function LicenseClient:_request(method: string, data: { [string]: any })
	data.password = self.Password

	local url = self.Endpoint
	local body = nil
	local headers = {
		["Content-Type"] = "application/json",
	}

	if method == "GET" or method == "DELETE" then
		url ..= "?" .. self:_query(data)
	else
		body = HttpService:JSONEncode(data)
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = url,
			Method = method,
			Headers = headers,
			Body = body,
		})
	end)

	if not ok then
		error("License request failed: " .. tostring(response), 2)
	end

	local decoded = {}
	if response.Body and response.Body ~= "" then
		decoded = HttpService:JSONDecode(response.Body)
	end

	if not response.Success then
		local message = decoded.error or response.StatusMessage or "Request failed"
		if response.StatusCode == 401 and tostring(message) == "" then
			message = "Unauthorized. Disable JWT verification for the Supabase Edge Function, or send a Supabase auth token."
		elseif response.StatusCode == 401 then
			message = tostring(message) .. " Disable JWT verification for the Supabase Edge Function if you are only using the password parameter."
		end
		error("License API error " .. tostring(response.StatusCode) .. ": " .. tostring(message), 2)
	end

	return decoded
end

function LicenseClient:_query(data: { [string]: any }): string
	local parts = {}

	for key, value in pairs(data) do
		table.insert(
			parts,
			HttpService:UrlEncode(tostring(key)) .. "=" .. HttpService:UrlEncode(tostring(value))
		)
	end

	return table.concat(parts, "&")
end

function LicenseClient:CheckLicense(productid: string, userid: string): boolean
	local result = self:_request("GET", {
		type = "normal",
		productid = productid,
		userid = userid,
	})

	return result.licensed == true
end

function LicenseClient:AddLicense(productid: string, userid: string)
	return self:_request("POST", {
		type = "normal",
		productid = productid,
		userid = userid,
	})
end

function LicenseClient:RemoveLicense(productid: string, userid: string)
	return self:_request("DELETE", {
		type = "normal",
		productid = productid,
		userid = userid,
	})
end

function LicenseClient:CreateProduct(productid: string)
	return self:_request("POST", {
		type = "product",
		productid = productid,
	})
end

function LicenseClient:GetProducts(): { string }
	local result = self:_request("GET", {
		type = "product",
	})

	return result.products or {}
end

function LicenseClient:DeleteProduct(productid: string)
	return self:_request("DELETE", {
		type = "product",
		productid = productid,
	})
end

function LicenseClient:RenameProduct(productid: string, newproductid: string)
	return self:_request("PATCH", {
		type = "product",
		productid = productid,
		newproductid = newproductid,
	})
end

return LicenseClient
```
