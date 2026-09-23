import { useMemo, useState, type ComponentType } from "react";
import { Command as Cmdk } from "cmdk";
import {
  Bot,
  Bug,
  Database,
  GitFork,
  HardDrive,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Workflow,
  Wrench,
  WandSparkles,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, NODE_CATEGORIES, categoryVar, type NodeCategory } from "@/lib/categories";
import { Kbd, Popover, PopoverAnchor, PopoverContent } from "@/primitives";
import type { NodeDefinitionView } from "./types";
import "./canvas.css";

/** Lucide icon for each node category. */
export const CATEGORY_ICON: Record<NodeCategory, ComponentType<LucideProps>> = {
  flow: Workflow,
  decision: GitFork,
  generation: Sparkles,
  agent: Bot,
  tool: Wrench,
  data: Database,
  retrieval: Search,
  state: HardDrive,
  human: UserCheck,
  safety: ShieldCheck,
  developer: Bug,
};

export interface NodePaletteMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Client (screen) coordinates to anchor the menu at; null centres it in its container. */
  anchor: { x: number; y: number } | null;
  catalog: NodeDefinitionView[];
  /** Recently used kinds, most recent first. */
  recent?: string[];
  onPick: (def: NodeDefinitionView) => void;
  /** Receives the current search text so the builder can start from it. */
  onAskBuilder?: (query: string) => void;
  placeholder?: string;
  /** Preferred side relative to the anchor. */
  side?: "bottom" | "right" | "top" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * Node palette: a cmdk list in a Popover anchored at a screen point. Opened
 * by the "+" button, a right-click (anchored at the pointer) or ⌘K / "/".
 * Groups node definitions by category with a "Recent" group first; fuzzy
 * search covers name, description, kind and category; the last row always
 * hands the query to the AI builder.
 */
export function NodePaletteMenu({
  open,
  onOpenChange,
  anchor,
  catalog,
  recent = [],
  onPick,
  onAskBuilder,
  placeholder = "Search nodes…",
  side = "bottom",
  align = "start",
  className,
}: NodePaletteMenuProps) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const byKind = new Map(catalog.map((d) => [d.kind, d]));
    const recentDefs = recent
      .map((k) => byKind.get(k))
      .filter((d): d is NodeDefinitionView => d !== undefined);
    const out: Array<{ id: string; heading: string; items: NodeDefinitionView[] }> = [];
    if (recentDefs.length > 0)
      out.push({ id: "recent", heading: "Recent", items: recentDefs.slice(0, 5) });
    for (const cat of NODE_CATEGORIES) {
      const items = catalog.filter((d) => d.category === cat);
      if (items.length > 0) out.push({ id: cat, heading: CATEGORY_LABEL[cat], items });
    }
    return out;
  }, [catalog, recent]);

  const pick = (def: NodeDefinitionView) => {
    onPick(def);
    onOpenChange(false);
  };

  const anchorStyle = anchor
    ? { position: "fixed" as const, left: anchor.x, top: anchor.y, width: 0, height: 0 }
    : { position: "absolute" as const, left: "50%", top: "40%", width: 0, height: 0 };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={anchorStyle} />
      </PopoverAnchor>
      <PopoverContent
        bare
        width={336}
        side={side}
        align={align}
        sideOffset={anchor ? 6 : 0}
        className={cn("overflow-hidden", className)}
        aria-label="Add node"
      >
        <Cmdk label="Add node" loop className="fa-palette flex min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <Cmdk.Input
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
            />
            <Kbd size="sm">Esc</Kbd>
          </div>
          <Cmdk.List className="max-h-[min(380px,55vh)] min-h-0 overflow-y-auto overscroll-contain p-1">
            <Cmdk.Empty className="px-2 py-6 text-center text-xs text-ink-3">
              No node matches.
            </Cmdk.Empty>
            {groups.map((group) => (
              <Cmdk.Group
                key={group.id}
                heading={group.heading}
                className="[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
              >
                {group.items.map((def) => {
                  const Icon = CATEGORY_ICON[def.category];
                  return (
                    <Cmdk.Item
                      key={`${group.id}:${def.kind}`}
                      value={`${group.id}:${def.kind}`}
                      keywords={[
                        def.name,
                        def.description,
                        def.kind,
                        CATEGORY_LABEL[def.category],
                        def.provider ?? "",
                      ]}
                      onSelect={() => pick(def)}
                      className={cn(
                        "relative flex min-h-10 cursor-default select-none items-center gap-2.5 rounded-xs px-2 py-1.5 text-sm text-ink outline-none",
                        "data-[selected=true]:bg-surface-3",
                      )}
                    >
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 [&_svg]:size-3.5"
                        style={{ color: categoryVar(def.category) }}
                      >
                        <Icon strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate">{def.name}</span>
                        <span className="mt-0.5 truncate text-2xs text-ink-3">
                          {def.description}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-2xs text-ink-3">
                        {def.provider ?? def.kind}
                      </span>
                    </Cmdk.Item>
                  );
                })}
              </Cmdk.Group>
            ))}
            {onAskBuilder ? (
              <Cmdk.Group className="border-t border-border pt-1">
                <Cmdk.Item
                  forceMount
                  value="builder:ask"
                  onSelect={() => {
                    onAskBuilder(query);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-xs px-2 text-sm text-ink outline-none",
                    "data-[selected=true]:bg-accent-soft",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent [&_svg]:size-3.5">
                    <WandSparkles strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Ask the AI builder
                    {query ? <span className="text-ink-3"> to add “{query}”</span> : null}
                  </span>
                  <Kbd size="sm">⏎</Kbd>
                </Cmdk.Item>
              </Cmdk.Group>
            ) : null}
          </Cmdk.List>
        </Cmdk>
      </PopoverContent>
    </Popover>
  );
}
