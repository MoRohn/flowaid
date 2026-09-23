import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type HTMLAttributes,
} from "react";
import { ClipboardPaste, Eye, EyeOff, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Input, useControllableState, useFieldControl } from "@/primitives";

export interface KeyValueRow {
  key: string;
  value: string;
  /** Masked in the UI (env secrets, API keys). */
  secret?: boolean;
}

export interface KeyValueEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: KeyValueRow[];
  defaultValue?: KeyValueRow[];
  onChange?: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Show the per-row secret toggle. */
  secrets?: boolean;
  /** Use the mono face for keys and values (headers, env vars). */
  mono?: boolean;
  /** Label for the add button. */
  addLabel?: string;
  /** Text shown when there are no rows. */
  emptyText?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** Per-row validation; return a message to flag the row. */
  validateRow?: (row: KeyValueRow, index: number, rows: KeyValueRow[]) => string | undefined;
  id?: string;
}

/**
 * Parses "Key: Value" (or "KEY=value") lines into rows. Blank lines and `#`
 * comments are skipped; a line without a separator becomes a key with an
 * empty value so nothing pasted is silently dropped.
 */
export function parseKeyValueText(text: string): KeyValueRow[] {
  const rows: KeyValueRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([^:=]+?)\s*[:=]\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      const key = match[1].trim();
      let value = (match[2] ?? "").trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      )
        value = value.slice(1, -1);
      rows.push({ key, value });
    } else {
      rows.push({ key: line, value: "" });
    }
  }
  return rows;
}

/** Merges pasted rows into existing rows, replacing values for keys that already exist (case-insensitive). */
export function mergeKeyValueRows(existing: KeyValueRow[], incoming: KeyValueRow[]): KeyValueRow[] {
  const next = existing.slice();
  for (const row of incoming) {
    const idx = next.findIndex(
      (r) => r.key.toLowerCase() === row.key.toLowerCase() && r.key !== "",
    );
    if (idx === -1) next.push(row);
    else {
      const current = next[idx];
      if (current) next[idx] = { ...current, value: row.value };
    }
  }
  return next;
}

/** Default row check: keys are required and unique (case-insensitive). */
export function defaultKeyValueRowIssue(
  row: KeyValueRow,
  index: number,
  rows: KeyValueRow[],
): string | undefined {
  if (row.key.trim() === "") return row.value.trim() === "" ? undefined : "Key is required";
  const dupe = rows.findIndex(
    (r, i) => i !== index && r.key.trim().toLowerCase() === row.key.trim().toLowerCase(),
  );
  if (dupe !== -1 && dupe < index) return `Duplicate of row ${dupe + 1}`;
  return undefined;
}

/**
 * Rows of key/value inputs for headers, query params and environment
 * variables. Paste multi-line "Key: Value" text into any key field to add
 * several rows at once; the secret toggle masks a value per row.
 */
export const KeyValueEditor = forwardRef<HTMLDivElement, KeyValueEditorProps>(
  function KeyValueEditor(
    {
      value,
      defaultValue = [],
      onChange,
      keyPlaceholder = "Key",
      valuePlaceholder = "Value",
      secrets = true,
      mono = true,
      addLabel = "Add row",
      emptyText = "No entries yet.",
      disabled,
      readOnly = false,
      invalid,
      validateRow = defaultKeyValueRowIssue,
      id,
      className,
      ...rest
    },
    ref,
  ) {
    const [rows, setRows] = useControllableState<KeyValueRow[]>(value, defaultValue, onChange);
    const [revealed, setRevealed] = useState<Record<number, boolean>>({});
    const field = useFieldControl({ id, disabled, "aria-invalid": invalid });
    const isDisabled = Boolean(field.disabled);
    const locked = isDisabled || readOnly;
    const baseId = useId();
    const keyRefs = useRef<Array<HTMLInputElement | null>>([]);

    const update = (index: number, patch: Partial<KeyValueRow>) => {
      setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    };
    const remove = (index: number) => {
      setRows(rows.filter((_, i) => i !== index));
      setRevealed({});
    };
    const add = () => {
      setRows([...rows, { key: "", value: "" }]);
      queueMicrotask(() => keyRefs.current[rows.length]?.focus());
    };

    const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text.includes("\n") && !/[:=]/.test(text)) return;
      const parsed = parseKeyValueText(text);
      if (parsed.length === 0) return;
      e.preventDefault();
      const current = rows[index];
      const others = rows.filter((r, i) => i !== index || r.key !== "" || r.value !== "");
      const base = current && current.key === "" && current.value === "" ? others : rows;
      setRows(mergeKeyValueRows(base, parsed));
    };

    return (
      <div
        ref={ref}
        id={field.id}
        role="group"
        aria-describedby={field["aria-describedby"]}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
        {...rest}
      >
        {rows.length === 0 ? (
          <p className="flex h-7 items-center rounded-sm border border-dashed border-border px-2 text-xs text-ink-3">
            {emptyText}
          </p>
        ) : null}
        {rows.map((row, index) => {
          const issue = validateRow(row, index, rows);
          const masked = row.secret === true && revealed[index] !== true;
          const rowId = `${baseId}-${index}`;
          return (
            <div key={rowId} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <Input
                  ref={(el) => {
                    keyRefs.current[index] = el;
                  }}
                  mono={mono}
                  aria-label={`Key ${index + 1}`}
                  placeholder={keyPlaceholder}
                  value={row.key}
                  invalid={issue !== undefined || undefined}
                  disabled={isDisabled}
                  readOnly={readOnly}
                  onChange={(e) => update(index, { key: e.target.value })}
                  onPaste={(e) => handlePaste(index, e)}
                  className="basis-[40%]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  mono={mono}
                  type={masked ? "password" : "text"}
                  aria-label={`Value ${index + 1}`}
                  placeholder={valuePlaceholder}
                  value={row.value}
                  disabled={isDisabled}
                  readOnly={readOnly}
                  onChange={(e) => update(index, { value: e.target.value })}
                  className="min-w-0 flex-1"
                  autoComplete="off"
                  spellCheck={false}
                  trailing={
                    secrets && !locked ? (
                      <IconButton
                        label={
                          row.secret ? (masked ? "Reveal value" : "Hide value") : "Mark as secret"
                        }
                        size="xs"
                        variant="ghost"
                        aria-pressed={row.secret === true}
                        className={cn(row.secret && "text-warn-text hover:text-warn-text")}
                        onClick={() => {
                          if (!row.secret) update(index, { secret: true });
                          else setRevealed((r) => ({ ...r, [index]: masked }));
                        }}
                      >
                        {row.secret && masked ? (
                          <EyeOff strokeWidth={1.75} />
                        ) : (
                          <Eye strokeWidth={1.75} />
                        )}
                      </IconButton>
                    ) : undefined
                  }
                />
                {!locked ? (
                  <IconButton
                    label="Remove row"
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(index)}
                  >
                    <X strokeWidth={1.75} />
                  </IconButton>
                ) : null}
              </div>
              {issue ? <p className="pl-0.5 text-2xs text-danger-text">{issue}</p> : null}
            </div>
          );
        })}
        {!locked ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={add}>
              {addLabel}
            </Button>
            <span className="ml-auto inline-flex items-center gap-1 text-2xs text-ink-3">
              <ClipboardPaste className="size-3" strokeWidth={1.75} aria-hidden="true" />
              Paste "Key: Value" lines
            </span>
          </div>
        ) : null}
      </div>
    );
  },
);
