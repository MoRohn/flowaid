---
"@flowaid/ui": patch
"@flowaid/web": patch
---

Smaller accessibility fixes. The Light / Dark / System theme choice in the navigation is one Tab
stop and the arrow keys move between the options and choose. Hiding or reopening "Start here"
keeps keyboard focus on its button instead of dropping it to the top of the page. Error messages
in toasts stay on screen, with a close button, until you dismiss them; other toasts still go after
a few seconds.
