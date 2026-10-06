---
"@flowaid/ui": patch
---

Confirmations for destructive actions (delete, revoke, Quit FlowAId) open with Cancel focused and
are announced as alerts, so pressing Enter by habit cancels instead of deleting or stopping
FlowAId. Other confirmations still open on their confirm button.
