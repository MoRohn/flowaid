---
"@flowaid/web": patch
"@flowaid/ui": patch
---

Quick add connects the new step and keeps it in view. With nothing selected, the palette suggests
steps "after" the last one, but a pick used to land unconnected and often off-screen; it now follows
that step (beside it, or where you right-clicked) and the canvas pans to it when it is out of sight.
`FlowCanvas`'s `onAddNode` also says whether the palette opened at the pointer or in the view.
