---
"@flowaid/web": patch
"@flowaid/ui": patch
---

New steps start without errors you did not cause. Adding a Boolean, Validator, Mock, Knowledge
base, Policy check, Text splitter or a LangChain step used to save empty stubs for its optional
settings (a Boolean's criteria, a Mock's failure, a reranker), which showed errors at once, came
back after every edit and could make a Mock fail every run. Optional settings are now saved only
once you fill them in, and clearing one removes it. The Problems list also matches the server's
after you clear an optional field, instead of showing a spurious "Invalid input".
