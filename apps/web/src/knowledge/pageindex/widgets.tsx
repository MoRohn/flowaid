"use client";
/**
 * SchemaForm widgets for the `flowaid.pageindex.*` nodes: fields marked
 * `x-ui-ext.widget: "pageindexSources"` (source ids) or `"pageindexDocuments"` (document ids, one
 * or many by the schema's type) pick from this workspace's PageIndex sources and documents instead
 * of typed UUIDs. An id that is not in the workspace (deleted, or from an imported workflow) shows
 * as unavailable so it is picked again. When the lists cannot load, a plain text field stays.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { X } from "lucide-react";
import { Checkbox, IconButton, Input, Select, SelectItem } from "@flowaid/ui/primitives";
import { TextWidget, primaryType, registerWidget, type SchemaWidgetProps } from "@flowaid/ui/forms";
import { currentWorkspace, get, getAll } from "~/api/client";
import type { KnowledgeSource } from "../model";
import type { DocumentSummary } from "./model";

export const UNAVAILABLE = "Unavailable resource — pick again";

interface Option {
  id: string;
  label: string;
  /** the source a document belongs to */
  group?: string;
}

function usePageIndexSources() {
  return useQuery({
    queryKey: ["knowledge-sources", currentWorkspace()],
    queryFn: () => getAll<KnowledgeSource>("/v1/knowledge/sources"),
    select: (rows) => rows.filter((s) => s.kind === "pageindex"),
    staleTime: 30_000,
  });
}

function useSourceOptions(): { options: Option[]; pending: boolean; failed: boolean } {
  const sources = usePageIndexSources();
  return {
    options: (sources.data ?? []).map((s) => ({ id: s.id, label: s.name })),
    pending: sources.isPending,
    failed: sources.isError,
  };
}

function useDocumentOptions(): { options: Option[]; pending: boolean; failed: boolean } {
  const sources = usePageIndexSources();
  const list = sources.data ?? [];
  const docs = useQueries({
    queries: list.map((s) => ({
      queryKey: ["pageindex-documents", currentWorkspace(), s.id],
      queryFn: () =>
        get<{ items: DocumentSummary[] }>(
          `/v1/pageindex/sources/${encodeURIComponent(s.id)}/documents`,
        ),
      staleTime: 30_000,
    })),
  });
  const options = list.flatMap((s, i) =>
    (docs[i]?.data?.items ?? []).map((d) => ({ id: d.documentId, label: d.title, group: s.name })),
  );
  return {
    options,
    pending: sources.isPending || docs.some((q) => q.isPending),
    failed: sources.isError || (docs.length > 0 && docs.every((q) => q.isError)),
  };
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** The text fallback: comma-separated ids for a list, the id itself for one. */
function IdsText({
  many,
  value,
  onChange,
  onBlur,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps & { many: boolean }) {
  const text = many
    ? isStringArray(value)
      ? value.join(", ")
      : ""
    : typeof value === "string"
      ? value
      : "";
  return (
    <Input
      aria-label={ariaLabel ?? label}
      value={text}
      mono
      disabled={disabled}
      onBlur={onBlur}
      placeholder={many ? "id, id, …" : "id"}
      onChange={(e) =>
        onChange(
          many
            ? e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
            : e.target.value.trim() || undefined,
        )
      }
    />
  );
}

function Picker({
  what,
  data,
  ...props
}: SchemaWidgetProps & {
  what: "source" | "document";
  data: { options: Option[]; pending: boolean; failed: boolean };
}) {
  const { schema, value, onChange, disabled, label } = props;
  // each checkbox needs its own id: inside a field row they would all take the row's
  const uid = useId();
  const many = primaryType(schema) === "array";
  // bindings or expressions are not ids: leave them to the text widget
  if (value !== undefined && value !== null && !isStringArray(value) && typeof value !== "string")
    return <TextWidget {...props} />;
  if (data.failed)
    return (
      <div className="flex flex-col gap-1">
        <IdsText {...props} many={many} />
        <p className="text-2xs text-ink-3">
          Could not load the PageIndex {what}s; enter {many ? "ids" : "an id"} instead.
        </p>
      </div>
    );
  const known = new Set(data.options.map((o) => o.id));
  const chosen = many
    ? isStringArray(value)
      ? value
      : []
    : typeof value === "string" && value
      ? [value]
      : [];
  const unknown = data.pending ? [] : chosen.filter((id) => !known.has(id));
  const empty = !data.pending && data.options.length === 0;

  const unavailable = unknown.length ? (
    <ul aria-label={`Unavailable ${what}s`} className="flex flex-col gap-1">
      {unknown.map((id) => (
        <li
          key={id}
          role="alert"
          className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn-soft px-2 py-1 text-xs text-warn-text"
        >
          <span className="min-w-0 flex-1">
            {UNAVAILABLE}
            <span className="ml-1.5 font-mono text-2xs">{id}</span>
          </span>
          <IconButton
            size="sm"
            variant="ghost"
            label={`Remove unavailable ${what} ${id}`}
            disabled={disabled}
            onClick={() => onChange(many ? chosen.filter((x) => x !== id) : undefined)}
          >
            <X strokeWidth={1.75} />
          </IconButton>
        </li>
      ))}
    </ul>
  ) : null;

  if (!many)
    return (
      <div className="flex flex-col gap-1.5">
        <Select
          aria-label={props["aria-label"] ?? label}
          value={typeof value === "string" && known.has(value) ? value : undefined}
          onValueChange={(v) => onChange(v)}
          placeholder={
            data.pending ? "Loading…" : empty ? `No PageIndex ${what}s` : `Choose a ${what}`
          }
          disabled={disabled || empty}
        >
          {data.options.map((o) => (
            <SelectItem key={o.id} value={o.id} description={o.group}>
              {o.label}
            </SelectItem>
          ))}
        </Select>
        {unavailable}
      </div>
    );

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter((x) => x !== id);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label={props["aria-label"] ?? label}
        aria-busy={data.pending}
        className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2"
      >
        {data.pending ? (
          <span className="text-xs text-ink-3">Loading…</span>
        ) : empty ? (
          <span className="text-xs text-ink-3">No PageIndex {what}s in this workspace yet.</span>
        ) : (
          data.options.map((o) => (
            <Checkbox
              key={o.id}
              id={`${uid}-${o.id}`}
              size="sm"
              label={o.label}
              description={o.group}
              checked={chosen.includes(o.id)}
              disabled={disabled}
              onCheckedChange={(v) => toggle(o.id, v === true)}
            />
          ))
        )}
      </div>
      {unavailable}
    </div>
  );
}

export function PageIndexSourcesWidget(props: SchemaWidgetProps) {
  return <Picker {...props} what="source" data={useSourceOptions()} />;
}

export function PageIndexDocumentsWidget(props: SchemaWidgetProps) {
  return <Picker {...props} what="document" data={useDocumentOptions()} />;
}

registerWidget("pageindexSources", PageIndexSourcesWidget);
registerWidget("pageindexDocuments", PageIndexDocumentsWidget);
