import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { Check, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, type NodeCategory } from "@/lib/categories";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SearchInput,
  ToggleGroup,
  ToggleGroupItem,
  useControllableState,
} from "@/primitives";
import { MiniGraph, type MiniGraphEdge, type MiniGraphNode } from "./MiniGraph";

export interface WorkflowTemplateView {
  id: string;
  name: string;
  description: string;
  /** Categories the template leans on; shown as chips and used for the filter. */
  categories: NodeCategory[];
  nodes: MiniGraphNode[];
  edges: MiniGraphEdge[];
  /** Extra search terms. */
  tags?: string[];
  /** Number of TypeSafe decisions in the template. */
  decisionCount?: number;
  /** What it needs before it can run, and whether the workspace has it; omit when unknown. */
  needs?: { label: string; ready: boolean }[];
}

export interface TemplateGalleryProps extends HTMLAttributes<HTMLDivElement> {
  templates: WorkflowTemplateView[];
  onUse: (template: WorkflowTemplateView) => void;
  search?: string;
  defaultSearch?: string;
  onSearchChange?: (value: string) => void;
  category?: NodeCategory | "all";
  defaultCategory?: NodeCategory | "all";
  onCategoryChange?: (category: NodeCategory | "all") => void;
  /** Column width floor for the responsive grid, in px. */
  minCardWidth?: number;
}

/** Case-insensitive search across name, description, tags and category labels; category filter narrows to templates that use it. */
export function filterTemplates(
  templates: readonly WorkflowTemplateView[],
  search: string,
  category: NodeCategory | "all",
): WorkflowTemplateView[] {
  const q = search.trim().toLowerCase();
  return templates.filter((t) => {
    if (category !== "all" && !t.categories.includes(category)) return false;
    if (!q) return true;
    const hay = [
      t.name,
      t.description,
      ...(t.tags ?? []),
      ...t.categories.map((c) => CATEGORY_LABEL[c]),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Searchable, filterable grid of workflow templates. Each card previews the
 * graph as a MiniGraph, lists its categories and node count, and offers
 * "Use template".
 */
export const TemplateGallery = forwardRef<HTMLDivElement, TemplateGalleryProps>(
  function TemplateGallery(
    {
      templates,
      onUse,
      search,
      defaultSearch = "",
      onSearchChange,
      category,
      defaultCategory = "all",
      onCategoryChange,
      minCardWidth = 260,
      className,
      ...rest
    },
    ref,
  ) {
    const [q, setQ] = useControllableState(search, defaultSearch, onSearchChange);
    const [cat, setCat] = useControllableState<NodeCategory | "all">(
      category,
      defaultCategory,
      onCategoryChange,
    );
    const categories = useMemo(() => {
      const seen = new Set<NodeCategory>();
      for (const t of templates) for (const c of t.categories) seen.add(c);
      return Array.from(seen);
    }, [templates]);
    const visible = useMemo(() => filterTemplates(templates, q, cat), [templates, q, cat]);

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-3", className)} {...rest}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search templates"
            aria-label="Search templates"
            className="w-full sm:w-64"
          />
          <div className="contain-inline-size min-w-0 flex-1 basis-60 overflow-x-auto py-0.5">
            <ToggleGroup
              type="single"
              size="sm"
              value={cat}
              onValueChange={(v) => {
                if (v) setCat(v as NodeCategory | "all");
              }}
              aria-label="Filter by category"
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              {categories.map((c) => (
                <ToggleGroupItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
            {visible.length} of {templates.length}
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<LayoutTemplate strokeWidth={1.75} aria-hidden="true" />}
            title="No templates match"
            description="Try a different search, or clear the category filter."
            primaryAction={
              <Button
                size="sm"
                onClick={() => {
                  setQ("");
                  setCat("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul
            role="list"
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minCardWidth}px), 1fr))`,
            }}
          >
            {visible.map((t) => (
              <li key={t.id} className="min-w-0">
                <Card interactive className="h-full" onDoubleClick={() => onUse(t)}>
                  <div className="flex items-center justify-center border-b border-border canvas-grid rounded-t-md px-3 py-3">
                    <MiniGraph nodes={t.nodes} edges={t.edges} label={`${t.name} preview`} />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <h3 className="text-sm font-semibold leading-tight tracking-tight text-ink">
                      {t.name}
                    </h3>
                    <p className="text-xs leading-normal text-ink-2">{t.description}</p>
                    {t.needs ? <TemplateNeeds needs={t.needs} /> : null}
                    <div className="flex flex-wrap gap-1">
                      {t.categories.map((c) => (
                        <Badge key={c} category={c} size="sm" dot>
                          {CATEGORY_LABEL[c]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                    <span className="min-w-0 truncate font-mono text-2xs text-ink-3 tabular">
                      {t.nodes.length} nodes
                      {t.decisionCount !== undefined
                        ? ` · ${t.decisionCount} ${t.decisionCount === 1 ? "decision" : "decisions"}`
                        : ""}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => onUse(t)}
                      aria-label={`Use template ${t.name}`}
                    >
                      Use template
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

/** "Ready to run", or each thing still to set up; the words carry the state, not the colour. */
function TemplateNeeds({ needs }: { needs: { label: string; ready: boolean }[] }) {
  const missing = needs.filter((n) => !n.ready);
  if (missing.length === 0)
    return (
      <p className="flex items-center gap-1 text-2xs text-ok-text">
        <Check className="size-3" strokeWidth={2} aria-hidden="true" />
        Ready to run{needs.length ? ` · uses ${needs.map((n) => n.label).join(", ")}` : ""}
      </p>
    );
  return (
    <div className="flex flex-col gap-0.5 text-2xs">
      <p className="text-ink-2">Needs before it runs:</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {needs.map((n) => (
          <li key={n.label} className={n.ready ? "text-ink-3" : "text-warn-text"}>
            <span aria-hidden="true">{n.ready ? "✓ " : "○ "}</span>
            {n.label}
            {n.ready ? " (ready)" : " (to set up)"}
          </li>
        ))}
      </ul>
    </div>
  );
}
