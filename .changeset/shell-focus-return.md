---
"@flowaid/ui": patch
---

Closing a dialog, side sheet or confirmation puts keyboard focus back on the control that opened
it, also when a menu item, a ⌘K command or a button that is not the dialog's own trigger opened
it. Before, focus fell to the top of the page after the navigation drawer, Quit FlowAId, Publish,
Add webhook and other dialogs opened from menus.
