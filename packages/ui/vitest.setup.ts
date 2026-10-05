import "@testing-library/jest-dom/vitest";
import { preloadCodeEditors } from "./src/forms/preload";

// The code and template editors load CodeMirror on demand (forms/lazyEditor.tsx). Tests render
// them as a page does once it has loaded; lazyEditor.test.tsx covers the loading itself.
await preloadCodeEditors();
