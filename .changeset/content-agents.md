---
"@flowaid/web": patch
---

Editing an agent keeps the settings the form doesn't show: temperature, max output tokens, the
token cap and streaming set through the API or CLI were dropped by the first edit in the app. They
now have their own "Advanced" group under Limits, and any other stored setting is saved back
unchanged.
