"use client";
/**
 * The "g o", "g w", "g r" … shortcuts the collapsed nav's tooltips and the ⌘K Navigate items
 * advertise: one per visible nav entry that has one, so a page the deployment does not ship
 * registers nothing. Rendered inside `AppShell`, whose provider holds the registry; they are
 * listed under "Navigate" in the "?" dialog and stay quiet while typing in a field.
 */
import { useShortcut } from "@flowaid/ui/shell";
import type { NavEntry } from "./nav";

export function NavShortcuts({
  entries,
  go,
}: {
  entries: readonly NavEntry[];
  /** opens an entry's path within the workspace */
  go: (path: string) => void;
}) {
  return (
    <>
      {entries.map((e) =>
        e.shortcut ? <NavShortcut key={e.id} keys={e.shortcut} entry={e} go={go} /> : null,
      )}
    </>
  );
}

function NavShortcut({
  keys,
  entry,
  go,
}: {
  keys: string;
  entry: NavEntry;
  go: (path: string) => void;
}) {
  useShortcut(keys, () => go(entry.path), {
    description: `Go to ${entry.label}`,
    group: "Navigate",
  });
  return null;
}
