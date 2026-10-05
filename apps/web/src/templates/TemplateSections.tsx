"use client";
/**
 * The Templates page's two lists: Business flows get their own short list at the top (complete
 * workflows for everyday operations), and every other template follows in the searchable gallery.
 * A search or a category filter covers every template, business flows included: while one is set
 * the gallery lists them all, so nothing matching is left out of the results.
 */
import { useState } from "react";
import type { NodeCategory } from "@flowaid/ui";
import { TemplateGallery, type WorkflowTemplateView } from "@flowaid/ui/builder";
import type { TemplateRow } from "~/admin/types";
import { splitBusinessFlows } from "./business";

export function TemplateSections({
  rows,
  views,
  onUse,
}: {
  rows: readonly TemplateRow[];
  views: WorkflowTemplateView[];
  onUse: (v: WorkflowTemplateView) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<NodeCategory | "all">("all");
  const { business } = splitBusinessFlows(rows);
  const ids = new Set(business.map((t) => t.id));
  const featured = views.filter((v) => ids.has(v.id));
  const rest = views.filter((v) => !ids.has(v.id));
  const filtering = search.trim() !== "" || category !== "all";
  const gallery = (templates: WorkflowTemplateView[]) => (
    <TemplateGallery
      templates={templates}
      onUse={onUse}
      search={search}
      onSearchChange={setSearch}
      category={category}
      onCategoryChange={setCategory}
    />
  );
  if (featured.length === 0) return gallery(views);
  return (
    <div className="flex flex-col gap-8">
      {/* the gallery below keeps its place (and the search field its focus) either way */}
      {filtering ? null : (
        <section aria-labelledby="business-flows" className="flex flex-col gap-3">
          <div>
            <h2 id="business-flows" className="text-base font-semibold text-ink">
              Business flows
            </h2>
            <p className="max-w-[70ch] text-xs text-ink-2">
              Complete workflows for everyday operations, built end to end: input, decisions, rules,
              people when needed, and the outcome. Create one and it is yours: rename it, change its
              settings (limits, windows, scores) in the workflow panel, and edit any step or
              wording.
            </p>
          </div>
          <TemplateGallery templates={featured} onUse={onUse} toolbar={false} />
        </section>
      )}
      <section aria-labelledby="more-templates" className="flex flex-col gap-3">
        <h2 id="more-templates" className="text-base font-semibold text-ink">
          {filtering ? "All templates" : "More templates"}
        </h2>
        {gallery(filtering ? views : rest)}
      </section>
    </div>
  );
}
