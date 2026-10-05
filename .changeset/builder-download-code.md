---
"@flowaid/web": minor
"@flowaid/ui": minor
---

Download code from the app. The builder's ⋯ menu, the command menu (⌘K) and every row of the
Versions page now offer **Download code**: choose the version or the current draft, whether the
package carries the FlowAId runtime packages or lists them from npm, and whether the last successful
run supplies its sample input and a recorded run for its tests. The dialog follows the build and
saves the zip; a draft with problems lists them instead. The Versions row menu also downloads the
workflow as a single TypeScript file. `ExportDialog` is exported from `@flowaid/ui/builder`, and
`TopBar` takes `onDownloadCode`.
