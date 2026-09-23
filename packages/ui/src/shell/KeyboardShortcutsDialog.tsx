import { useMemo } from "react";
import { cn } from "@/lib/cn";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kbd,
  Shortcut,
} from "@/primitives";
import { useShortcutPlatform, useShortcuts, type RegisteredShortcut } from "./ShortcutProvider";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra shortcuts to list that are handled elsewhere (canvas gestures, editor keys). */
  extra?: Array<Pick<RegisteredShortcut, "keys" | "description" | "group">>;
  /** Order of groups; unlisted groups follow alphabetically. */
  groupOrder?: string[];
  className?: string;
}

/** Renders "g w" as two caps with a gap, "mod+k" as one joined cap. */
function ShortcutKeys({ keys }: { keys: string }) {
  const platform = useShortcutPlatform();
  const steps = keys.trim().split(/\s+/);
  if (steps.length > 1) {
    return (
      <span className="inline-flex items-center gap-1">
        {steps.map((step, i) => (
          <span key={`${step}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-2xs text-ink-3">then</span> : null}
            <Shortcut shortcut={step} platform={platform} separate />
          </span>
        ))}
      </span>
    );
  }
  const only = steps[0] ?? "";
  if (only === "?") return <Kbd>?</Kbd>;
  return <Shortcut shortcut={only} platform={platform} separate />;
}

/**
 * Lists every registered shortcut grouped by section, in two columns on wide
 * screens. Opened with "?" by AppShell; the registry comes from
 * ShortcutProvider so the list is always what actually works.
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  extra = [],
  groupOrder = ["General", "Navigate", "Workflow", "Panels", "Canvas"],
  className,
}: KeyboardShortcutsDialogProps) {
  const registered = useShortcuts();
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ keys: string; bindings: string[]; description: string }>>();
    // Components mounted more than once (two canvases on a page) register the same
    // scoped shortcut twice; list it once.
    const seen = new Set<string>();
    const push = (group: string, keys: string, bindings: string[], description?: string) => {
      if (!description) return;
      const identity = `${group}\u0000${bindings.join("|")}\u0000${description}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      const list = map.get(group) ?? [];
      list.push({ keys, bindings, description });
      map.set(group, list);
    };
    for (const s of registered) push(s.group, s.keys, s.bindings, s.description);
    for (const s of extra) push(s.group, s.keys, [s.keys], s.description);
    const names = Array.from(map.keys()).sort((a, b) => {
      const ia = groupOrder.indexOf(a);
      const ib = groupOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return names.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [registered, extra, groupOrder]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className={className}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {total} shortcuts. Press <Kbd size="sm">?</Kbd> anywhere to open this list.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          {groups.length === 0 ? (
            <p className="text-xs text-ink-3">No shortcuts are registered on this page.</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.name} className="flex min-w-0 flex-col gap-1">
              <h3 className="text-eyebrow mb-1">{group.name}</h3>
              <ul className="flex flex-col">
                {group.items.map((item, i) => (
                  <li
                    key={`${item.keys}-${i}`}
                    className={cn(
                      "flex h-8 items-center justify-between gap-4 border-t border-border text-xs text-ink-2",
                      i === 0 && "border-t-0",
                    )}
                  >
                    <span className="min-w-0 truncate">{item.description}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {item.bindings.map((b, j) => (
                        <span key={`${b}-${j}`} className="inline-flex items-center gap-1.5">
                          {j > 0 ? <span className="text-2xs text-ink-3">or</span> : null}
                          <ShortcutKeys keys={b} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
