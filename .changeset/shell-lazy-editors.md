---
"@flowaid/ui": patch
"@flowaid/web": patch
---

Pages load about 150 KB (gzip) less JavaScript: the code and template editors fetch CodeMirror
only when one appears, instead of every list page, every workflow page and the external review
page loading it up front (Agents 654 → 503 KB, Templates 650 → 498 KB, `/review` 700 → 541 KB, the
builder 1,650 → 1,491 KB). While it loads, a box of the editor's size holds its place.
`CodeEditor`, `ExpressionInput`, `ExpressionTextarea`, `TemplateEditor` and `TemplateInput` keep
their props and refs; `preloadCodeEditors()` fetches them ahead of time. `EMPTY_SCOPE` is also
exported from the CodeMirror-free expression helpers.
