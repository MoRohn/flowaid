/**
 * A left click without modifier keys: the one a client-side router may take over. Cmd, ctrl,
 * shift and middle clicks stay with the browser so "open in a new tab" keeps working on links.
 */
export function isPlainClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
