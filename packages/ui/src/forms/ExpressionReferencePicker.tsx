import { useMemo, useState, type ReactNode } from "react";
import { Braces, ChevronRight, Database, Variable, Workflow } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ExpressionScope, PortView } from "@/types";
import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Tooltip,
} from "@/primitives";
import { scopePaths } from "./expression";

export interface ExpressionReferencePickerProps {
  scope: ExpressionScope;
  /** Called with the dotted path (e.g. `nodes.intent.output.confidence`). */
  onInsert: (path: string) => void;
  disabled?: boolean;
  /** Custom trigger; defaults to a Braces icon button. */
  trigger?: ReactNode;
  className?: string;
  /** Tooltip / aria-label for the default trigger. */
  label?: string;
}

interface RowProps {
  path: string;
  name: string;
  type: string;
  description?: string;
  depth: number;
  onSelect: (path: string) => void;
}

function ReferenceRow({ path, name, type, description, depth, onSelect }: RowProps) {
  return (
    <Tooltip content={<span className="font-mono">{path}</span>} side="right">
      <button
        type="button"
        onClick={() => onSelect(path)}
        className={cn(
          "group flex h-7 w-full min-w-0 items-center gap-2 rounded-xs pr-2 text-left text-xs text-ink",
          "transition-colors duration-(--dur-fast) hover:bg-surface-3",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
        {description ? (
          <span className="hidden min-w-0 max-w-[45%] truncate text-2xs text-ink-3 sm:inline">
            {description}
          </span>
        ) : null}
        <span className="shrink-0 rounded-xs bg-surface-3 px-1 font-mono text-2xs leading-4 text-ink-3">
          {type}
        </span>
      </button>
    </Tooltip>
  );
}

function GroupHeading({
  icon,
  children,
  count,
}: {
  icon: ReactNode;
  children: ReactNode;
  count: number;
}) {
  return (
    <div className="flex h-6 items-center gap-1.5 px-2 text-2xs font-medium text-ink-2 [&_svg]:size-3.5 [&_svg]:text-ink-3">
      {icon}
      <span>{children}</span>
      <span className="ml-auto font-mono text-2xs text-ink-3">{count}</span>
    </div>
  );
}

/**
 * "Insert reference" popover: the expression scope as a tree (inputs,
 * variables, nodes → outputs) with a filter box. Selecting a row calls
 * `onInsert` with the path; the caller wraps it in braces as needed.
 */
export function ExpressionReferencePicker({
  scope,
  onInsert,
  disabled,
  trigger,
  className,
  label = "Insert reference",
}: ExpressionReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const total = useMemo(() => scopePaths(scope).length, [scope]);

  const matches = (...parts: Array<string | undefined>) =>
    q === "" || parts.some((p) => p?.toLowerCase().includes(q));

  const select = (path: string) => {
    onInsert(path);
    setOpen(false);
    setQuery("");
  };

  const inputs = scope.inputs.filter((p) => matches(p.id, p.label, p.description));
  const variables = scope.variables.filter((v) => matches(v.name, v.type));
  const nodes = scope.nodes
    .map((n) => ({
      ...n,
      outputs: n.outputs.filter((p) => matches(p.id, p.label, p.description, n.id, n.name)),
    }))
    .filter((n) => n.outputs.length > 0 || matches(n.id, n.name));
  const empty = inputs.length === 0 && variables.length === 0 && nodes.length === 0;

  const portRows = (prefix: string, ports: PortView[], depth: number) =>
    ports.map((p) => (
      <ReferenceRow
        key={p.id}
        path={`${prefix}.${p.id}`}
        name={p.id}
        type={p.type}
        description={p.description ?? (p.label !== p.id ? p.label : undefined)}
        depth={depth}
        onSelect={select}
      />
    ));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <IconButton
            label={label}
            size="xs"
            variant="ghost"
            disabled={disabled}
            className={className}
            tooltipSide="top"
          >
            <Braces strokeWidth={1.75} />
          </IconButton>
        )}
      </PopoverTrigger>
      <PopoverContent
        bare
        width={320}
        align="end"
        className="flex max-h-[min(380px,60vh)] flex-col"
      >
        <div className="shrink-0 border-b border-border p-2">
          <SearchInput
            size="sm"
            value={query}
            onValueChange={setQuery}
            placeholder={`Filter ${total} references`}
            aria-label="Filter references"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {empty ? (
            <p className="px-2 py-6 text-center text-xs text-ink-3">
              {total === 0
                ? "Nothing upstream yet. Connect a node or add an input."
                : "No reference matches."}
            </p>
          ) : null}
          {inputs.length > 0 ? (
            <div className="pb-1">
              <GroupHeading icon={<Database strokeWidth={1.75} />} count={inputs.length}>
                Inputs
              </GroupHeading>
              {portRows("input", inputs, 1)}
            </div>
          ) : null}
          {variables.length > 0 ? (
            <div className="pb-1">
              <GroupHeading icon={<Variable strokeWidth={1.75} />} count={variables.length}>
                Variables
              </GroupHeading>
              {variables.map((v) => (
                <ReferenceRow
                  key={v.name}
                  path={`variables.${v.name}`}
                  name={v.name}
                  type={v.type}
                  depth={1}
                  onSelect={select}
                />
              ))}
            </div>
          ) : null}
          {nodes.length > 0 ? (
            <div className="pb-1">
              <GroupHeading icon={<Workflow strokeWidth={1.75} />} count={nodes.length}>
                Nodes
              </GroupHeading>
              {nodes.map((n) => {
                const isCollapsed = collapsed[n.id] === true && q === "";
                return (
                  <div key={n.id}>
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed((c) => ({ ...c, [n.id]: !isCollapsed }))}
                      className="flex h-7 w-full items-center gap-1.5 rounded-xs pl-[18px] pr-2 text-left text-xs transition-colors duration-(--dur-fast) hover:bg-surface-3"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast)",
                          !isCollapsed && "rotate-90",
                        )}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{n.name}</span>
                      <span className="shrink-0 font-mono text-2xs text-ink-3">{n.id}</span>
                    </button>
                    {!isCollapsed ? portRows(`nodes.${n.id}.output`, n.outputs, 2) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
