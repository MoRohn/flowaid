import { preloadCodeEditors } from "@flowaid/ui/forms";

// The code and template editors load CodeMirror on demand; tests render them as a page does once
// it has loaded (packages/ui/src/forms/lazyEditor.test.tsx covers the loading itself).
await preloadCodeEditors();
