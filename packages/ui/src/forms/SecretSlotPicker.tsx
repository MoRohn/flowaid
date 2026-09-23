import { KeyRound, Plus } from "lucide-react";
import type { CredentialSlot, SecretDecl, SecretName } from "@flowaid/workflow-core";
import { cn } from "@/lib/cn";
import { FieldRow, Select, SelectItem } from "@/primitives";

/** Select value for "leave the slot unbound" (optional slots only). */
export const NO_SECRET_VALUE = "__none__";
/** Select value for the "Declare new secret…" action. */
export const DECLARE_SECRET_VALUE = "__declare__";

export interface SecretSlotPickerProps {
  /** `NodeManifest.credentials`: the credential slots the node type declares. */
  slots: readonly CredentialSlot[];
  /** `WorkflowDefinition.secrets`: the symbolic secrets declared on the workflow. */
  secrets: readonly SecretDecl[];
  /** `node.credentials`: slot name → symbolic secret name. */
  value: Readonly<Record<string, SecretName>>;
  onChange?: (next: Record<string, SecretName>) => void;
  /** "Declare new secret…": the app opens its declare-secret dialog for this slot (and binds the result through `onChange`). */
  onDeclareSecret?: (slot: CredentialSlot) => void;
  disabled?: boolean;
  className?: string;
}

/** Secrets whose `credentialType` the slot accepts, in declaration order. */
export function secretsForSlot(slot: CredentialSlot, secrets: readonly SecretDecl[]): SecretDecl[] {
  return secrets.filter((s) => slot.types.includes(s.credentialType));
}

function humanizeSlot(name: string): string {
  const spaced = name.replace(/_+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Credential slots of a node (UI.md §5), rendered above its config form: one
 * picker per `NodeManifest.credentials[]` entry listing the workflow's
 * declared secrets (`definition.secrets`) of an accepted `credentialType`,
 * plus "Declare new secret…". Secrets are symbolic names; the value is bound
 * per environment at deploy time, never here.
 */
export function SecretSlotPicker({
  slots,
  secrets,
  value,
  onChange,
  onDeclareSecret,
  disabled = false,
  className,
}: SecretSlotPickerProps) {
  if (slots.length === 0) return null;
  return (
    <section
      aria-label="Credentials"
      className={cn(
        "flex flex-col gap-3 rounded-sm border border-border bg-surface-2/60 p-3",
        className,
      )}
    >
      <h3 className="text-eyebrow flex items-center gap-1.5">
        <KeyRound className="size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
        Credentials
      </h3>
      {slots.map((slot) => {
        const options = secretsForSlot(slot, secrets);
        const current = value[slot.name];
        const bound = current !== undefined && options.some((s) => s.name === current);
        const unknownBinding = current !== undefined && !bound;
        const missing = slot.required && current === undefined;
        const error = unknownBinding
          ? `${current} is not a declared secret of type ${slot.types.join(" / ")}`
          : missing && options.length === 0
            ? `Declare a ${slot.types.join(" / ")} secret for this slot`
            : missing
              ? "Choose a secret"
              : undefined;
        const hint = [
          slot.description,
          `Accepts ${slot.types.join(", ")}`,
          slot.scopes && slot.scopes.length > 0
            ? `needs scopes ${slot.scopes.join(", ")}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <FieldRow
            key={slot.name}
            label={humanizeSlot(slot.name)}
            required={slot.required}
            optional={!slot.required}
            hint={hint}
            error={error}
            disabled={disabled}
          >
            <Select
              value={current ?? (slot.required ? undefined : NO_SECRET_VALUE)}
              placeholder={options.length === 0 ? "No matching secrets" : "Choose a secret…"}
              mono={current !== undefined}
              leading={<KeyRound strokeWidth={1.75} />}
              onValueChange={(next) => {
                if (next === DECLARE_SECRET_VALUE) {
                  onDeclareSecret?.(slot);
                  return;
                }
                const out: Record<string, SecretName> = { ...value };
                if (next === NO_SECRET_VALUE) delete out[slot.name];
                else out[slot.name] = next;
                onChange?.(out);
              }}
              disabled={disabled}
            >
              {!slot.required ? <SelectItem value={NO_SECRET_VALUE}>None</SelectItem> : null}
              {unknownBinding ? (
                <SelectItem value={current} description="Not declared on this workflow">
                  {current}
                </SelectItem>
              ) : null}
              {options.map((s) => (
                <SelectItem
                  key={s.name}
                  value={s.name}
                  description={s.description ?? s.credentialType}
                  className="font-mono text-xs"
                >
                  {s.name}
                </SelectItem>
              ))}
              {onDeclareSecret ? (
                <SelectItem value={DECLARE_SECRET_VALUE} icon={<Plus strokeWidth={1.75} />}>
                  Declare new secret…
                </SelectItem>
              ) : null}
            </Select>
          </FieldRow>
        );
      })}
    </section>
  );
}
