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
