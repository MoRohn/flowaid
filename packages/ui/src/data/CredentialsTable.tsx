import { useMemo, useState, type ReactNode } from "react";
import { Ellipsis, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CredentialView } from "@/types";
import {
  Badge,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@/primitives";
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
  type DataTableProps,
} from "./DataTable";
import { RelativeTime } from "./RelativeTime";

export type CredentialStatus = "active" | "expiring" | "expired";

/** Credential row: the shared view plus scopes and lifecycle fields. */
export interface CredentialListItemView extends CredentialView {
  /** Provider key for the icon slot, e.g. "openai", "slack". */
  provider?: string;
  scopes?: string[];
  status?: CredentialStatus;
  createdAt?: string;
  rotatedAt?: string;
  expiresAt?: string;
  /** Who created it, for the tooltip. */
  createdBy?: string;
}

export interface CredentialsTableProps extends Omit<
  DataTableProps<CredentialListItemView>,
  "columns" | "data" | "itemLabel"
> {
  credentials: readonly CredentialListItemView[];
  onRotate?: (credential: CredentialListItemView) => void | Promise<void>;
  onDelete?: (credential: CredentialListItemView) => void | Promise<void>;
  onOpen?: (credential: CredentialListItemView) => void;
  /** Icon for the provider column; falls back to a key icon. */
  renderProviderIcon?: (credential: CredentialListItemView) => ReactNode;
  /** Visible scope chips before collapsing into "+n". Default 2. */
  maxScopes?: number;
}

const helper = createDataTableColumns<CredentialListItemView>();

const ENV_TONE: Record<string, "ok" | "neutral" | "outline"> = {
  production: "ok",
  staging: "neutral",
  development: "outline",
};

/** Scope chips with overflow collapsed into "+n" and a tooltip listing the rest. */
export function ScopeChips({
  scopes,
  max = 2,
  className,
}: {
  scopes: string[];
  max?: number;
  className?: string;
}) {
  if (scopes.length === 0) return <span className="text-2xs text-ink-3">No scopes</span>;
  const shown = scopes.slice(0, max);
  const rest = scopes.slice(max);
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {shown.map((s) => (
        <Badge key={s} tone="outline" mono size="sm" className="max-w-40 truncate">
          {s}
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Tooltip content={<span className="font-mono">{rest.join(" · ")}</span>}>
          <Badge tone="neutral" mono size="sm" tabIndex={0}>
            +{rest.length}
          </Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

/**
 * Credentials list: name, type with a provider icon slot, environment,
 * scope chips, last used, and rotate/delete actions. Delete asks for
 * confirmation before calling `onDelete`.
 */
export function CredentialsTable({
  credentials,
  onRotate,
  onDelete,
  onOpen,
  renderProviderIcon,
  maxScopes = 2,
  onRowActivate,
  defaultSorting,
  ...rest
}: CredentialsTableProps) {
  const [pendingDelete, setPendingDelete] = useState<CredentialListItemView | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);

  const columns = useMemo<DataTableColumns<CredentialListItemView>>(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Name",
          size: 240,
          minSize: 160,
          meta: { grow: true },
          cell: ({ row }) => {
            const c = row.original;
            return (
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-ink-3 [&_svg]:size-3.5">
                  {renderProviderIcon?.(c) ?? <KeyRound strokeWidth={1.75} aria-hidden="true" />}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-medium text-ink">{c.name}</span>
                  <span className="truncate font-mono text-2xs text-ink-3">{c.id}</span>
                </span>
                {c.status === "expiring" ? (
                  <Badge tone="warn" dot size="sm">
                    Expiring
                  </Badge>
                ) : c.status === "expired" ? (
                  <Badge tone="danger" dot size="sm">
                    Expired
                  </Badge>
                ) : null}
              </span>
            );
          },
        }),
        helper.accessor("type", {
          header: "Type",
          size: 170,
          minSize: 120,
          meta: { mono: true },
          cell: ({ getValue, row }) => (
            <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
              <span className="truncate">{getValue()}</span>
              {row.original.provider ? (
                <span className="shrink-0 text-ink-3">{row.original.provider}</span>
              ) : null}
            </span>
          ),
        }),
        helper.accessor((c) => c.environment ?? "", {
          id: "environment",
          header: "Environment",
          size: 130,
          minSize: 110,
          cell: ({ getValue }) => {
            const env = getValue();
            if (!env) return <span className="text-2xs text-ink-3">All</span>;
            return (
              <Badge tone={ENV_TONE[env] ?? "neutral"} dot className="capitalize">
                {env}
              </Badge>
            );
          },
        }),
        helper.accessor((c) => c.scopes?.length ?? 0, {
          id: "scopes",
          header: "Scopes",
          size: 240,
          minSize: 160,
          sortFn: "basic",
          cell: ({ row }) => <ScopeChips scopes={row.original.scopes ?? []} max={maxScopes} />,
        }),
        helper.accessor((c) => c.lastUsedAt, {
          id: "lastUsed",
          header: "Last used",
          size: 120,
          minSize: 100,
          sortFn: "datetime",
          sortUndefined: "last",
          sortDescFirst: true,
          cell: ({ getValue }) => {
            const v = getValue();
            return v ? (
              <RelativeTime date={v} mono className="text-ink-2" />
            ) : (
              <span className="text-2xs text-ink-3">Never</span>
            );
          },
        }),
        helper.display({
          id: "actions",
          header: "",
          size: 72,
          minSize: 72,
          maxSize: 72,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          meta: { locked: true, title: "Actions", align: "end", className: "px-1" },
          cell: ({ row }) => {
            const c = row.original;
            return (
              <span
                role="presentation"
                className="flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <IconButton
                  size="sm"
                  label="Rotate secret"
                  disabled={!onRotate}
                  loading={rotating === c.id}
                  onClick={() => {
                    if (!onRotate) return;
                    const result = onRotate(c);
                    if (result instanceof Promise) {
                      setRotating(c.id);
                      void result.finally(() => setRotating(null));
                    }
                  }}
                  className="text-ink-3"
                >
                  <RotateCw strokeWidth={1.75} />
                </IconButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      size="sm"
                      label={`More actions for ${c.name}`}
                      tooltip={false}
                      className="text-ink-3"
                    >
                      <Ellipsis strokeWidth={1.75} />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onOpen?.(c)} disabled={!onOpen}>
                      View details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<RotateCw strokeWidth={1.75} />}
                      disabled={!onRotate}
                      onSelect={() => {
                        if (onRotate) void onRotate(c);
                      }}
                    >
                      Rotate secret
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      icon={<Trash2 strokeWidth={1.75} />}
                      destructive
                      disabled={!onDelete}
                      onSelect={() => setPendingDelete(c)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            );
          },
        }),
      ]),
    [renderProviderIcon, maxScopes, onRotate, onDelete, onOpen, rotating],
  );

  return (
    <>
      <DataTable<CredentialListItemView>
        columns={columns}
        data={credentials}
        itemLabel={["credential", "credentials"]}
        defaultSorting={defaultSorting ?? [{ id: "lastUsed", desc: true }]}
        onRowActivate={onRowActivate ?? onOpen}
        aria-label="Credentials"
        {...rest}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        variant="danger"
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete credential?"}
        description="Nodes that reference this credential will fail at their next run until they are reconfigured."
        confirmLabel="Delete credential"
        onConfirm={async () => {
          if (pendingDelete && onDelete) await onDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
