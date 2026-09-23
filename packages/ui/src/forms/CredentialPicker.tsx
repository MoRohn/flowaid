import { forwardRef, useMemo, type ReactNode } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { KeyRound, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CredentialView } from "@/types";
import {
  Badge,
  Button,
  EmptyState,
  Select,
  SelectItem,
  SelectSeparator,
  type SelectProps,
} from "@/primitives";

export const CREATE_CREDENTIAL_VALUE = "__flowaid_create_credential__";

export interface CredentialPickerProps extends Omit<
  SelectProps,
  "children" | "value" | "defaultValue" | "onValueChange"
> {
  credentials: CredentialView[];
  /** Only credentials of this type are listed, e.g. "http_bearer", "openai". */
  credentialType?: string;
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (credentialId: string) => void;
  /** Called from the final "Create credential" item and from the empty state. */
  onCreate?: (credentialType?: string) => void;
  /** Icon per credential type; falls back to a key icon. */
  typeIcon?: (credential: CredentialView) => ReactNode;
  /** Human label per credential type, used in the empty state. */
  typeLabel?: (type: string) => string;
}

/** Credentials matching `credentialType` (all when omitted), newest use first. */
export function filterCredentials(
  credentials: CredentialView[],
  credentialType?: string,
): CredentialView[] {
  const list = credentialType
    ? credentials.filter((c) => c.type === credentialType)
    : credentials.slice();
  return list.sort((a, b) => {
    const at = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const bt = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    return bt - at || a.name.localeCompare(b.name);
  });
}

function lastUsed(iso: string | undefined): string {
  if (!iso) return "Never used";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Never used";
  return `Used ${formatDistanceToNowStrict(t, { addSuffix: true })}`;
}

function humanType(type: string): string {
  return type.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Select of credentials filtered by type, with a type icon, environment chip
 * and "last used" hint per item, and a final "Create credential" entry. When
 * nothing matches, an empty state explains what to create.
 */
export const CredentialPicker = forwardRef<HTMLButtonElement, CredentialPickerProps>(
  function CredentialPicker(
    {
      credentials,
      credentialType,
      value,
      defaultValue,
      onValueChange,
      onCreate,
      typeIcon,
      typeLabel = humanType,
      placeholder = "Choose a credential",
      className,
      disabled,
      ...rest
    },
    ref,
  ) {
    const list = useMemo(
      () => filterCredentials(credentials, credentialType),
      [credentials, credentialType],
    );
    const typeName = credentialType ? typeLabel(credentialType) : "credential";

    if (list.length === 0) {
      return (
        <EmptyState
          size="sm"
          icon={<KeyRound strokeWidth={1.75} />}
          title={credentialType ? `No ${typeName} credential yet` : "No credentials yet"}
          description={
            credentialType
              ? `This node needs a credential of type ${typeName}. Create one in Settings › Credentials, or add it here; the secret is stored encrypted and never shown again.`
              : "Create a credential to let this node authenticate. Secrets are stored encrypted and never shown again."
          }
          primaryAction={
            onCreate ? (
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Plus />}
                disabled={disabled}
                onClick={() => onCreate(credentialType)}
              >
                Create credential
              </Button>
            ) : undefined
          }
          className={cn("rounded-sm border border-dashed border-border", className)}
        />
      );
    }

    const selected = list.find((c) => c.id === value);

    return (
      <Select
        ref={ref}
        value={value ?? undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        leading={
          selected ? (
            (typeIcon?.(selected) ?? <KeyRound strokeWidth={1.75} />)
          ) : (
            <KeyRound strokeWidth={1.75} />
          )
        }
        className={className}
        onValueChange={(next) => {
          if (next === CREATE_CREDENTIAL_VALUE) {
            onCreate?.(credentialType);
            return;
          }
          onValueChange?.(next);
        }}
        {...rest}
      >
        {list.map((c) => (
          <SelectItem
            key={c.id}
            value={c.id}
            icon={typeIcon?.(c) ?? <KeyRound strokeWidth={1.75} />}
            description={
              <span className="inline-flex items-center gap-1.5">
                {c.environment ? (
                  <Badge size="sm" mono tone={c.environment === "production" ? "warn" : "neutral"}>
                    {c.environment}
                  </Badge>
                ) : null}
                <span>{lastUsed(c.lastUsedAt)}</span>
              </span>
            }
            meta={credentialType ? undefined : humanType(c.type)}
          >
            {c.name}
          </SelectItem>
        ))}
        {onCreate ? (
          <>
            <SelectSeparator />
            <SelectItem
              value={CREATE_CREDENTIAL_VALUE}
              icon={<Plus strokeWidth={1.75} />}
              className="text-accent-text"
            >
              Create credential
            </SelectItem>
          </>
        ) : null}
      </Select>
    );
  },
);
