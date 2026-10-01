"use client";
/**
 * A task node's credential slots at the top of its Config tab: bind each slot to one of the
 * workflow's secrets, or add a secret for it in one step (declared on the workflow and bound to the
 * slot together). Under each bound slot it says where the key comes from when the draft runs.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CredentialSlot, WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import { SecretSlotPicker, humanizeSlot } from "@flowaid/ui/forms";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  FieldRow,
  Input,
  RadioGroup,
  RadioItem,
} from "@flowaid/ui/primitives";
import { get, getAll } from "~/api/client";
import { useSession } from "~/session";
import { providerName } from "~/admin/providerNames";
import type { BuilderStore } from "./store";
import { useModelViews } from "./models";
import {
  SECRET_NAME,
  credentialTypeLabel,
  keySource,
  suggestSecretName,
  type KeySource,
  type KeySources,
} from "./keySources";

export function useKeySources(): KeySources {
  const s = useSession();
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<{ id: string; configuredOnServer: boolean }[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<{ type: string }>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  return {
    server: Object.fromEntries((providers.data ?? []).map((p) => [p.id, p.configuredOnServer])),
    saved: (credentials.data ?? []).map((c) => c.type),
  };
}

const article = (label: string) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

const SOURCE_BADGE: Record<KeySource["kind"], string> = {
  server: "key set on this server",
  none: "no key needed",
  saved: "credential saved",
  missing: "not set up yet",
};

export function CredentialSlots({
  node,
  slots,
  definition,
  store,
  readOnly,
  workflowId,
}: {
  node: Extract<WorkflowNode, { kind: "task" }>;
  slots: readonly CredentialSlot[];
  definition: WorkflowDefinition;
  store: BuilderStore;
  readOnly: boolean;
  workflowId: string;
}) {
  const s = useSession();
  const sources = useKeySources();
  const [declaring, setDeclaring] = useState<CredentialSlot | null>(null);
  // the step's model decides which provider answers, so its key type comes first
  const models = useModelViews();
  const model = (node.config as { model?: unknown }).model;
  const provider =
    model && typeof model === "object" && "provider" in model
      ? String(model.provider)
      : models.find((m) => m.id === model)?.provider;
  const preferred = provider
    ? provider === "ollama"
      ? "ollama.none"
      : `${provider}.api_key`
    : undefined;
  const settingsHref = `/${s.ws}/workflows/${workflowId}/settings?tab=secrets`;

  const bound = slots.flatMap((slot) => {
    const name = node.credentials[slot.name];
    const secret = name ? definition.secrets.find((x) => x.name === name) : undefined;
    return secret
      ? [{ slot, secret, source: keySource(secret.credentialType, sources, secret.required) }]
      : [];
  });

  return (
    <div className="flex flex-col gap-2">
      <SecretSlotPicker
        slots={slots}
        secrets={definition.secrets}
        value={node.credentials}
        typeLabel={credentialTypeLabel}
        disabled={readOnly}
        onChange={(next) =>
          store.getState().updateNode(
            node.id,
            (n) => {
              if (n.kind === "task") n.credentials = next;
            },
            "Bind credential",
          )
        }
        {...(!readOnly ? { onDeclareSecret: setDeclaring } : {})}
      />
      {bound.map(({ slot, secret, source }) => (
        <FieldHint key={slot.name}>
          <span className="font-mono">{secret.name}</span>:{" "}
          {source.kind === "server" ? (
            <>
              draft runs use the {providerName(source.provider)} key set on this server, unless you
              bind a credential to it for the environment in{" "}
              <Link className="text-accent-text hover:underline" href={settingsHref}>
                Secrets
              </Link>
              .
            </>
          ) : source.kind === "none" ? (
            <>no key needed; runs reach Ollama on this computer.</>
          ) : source.kind === "saved" ? (
            <>
              bind your saved credential to it for each environment in{" "}
              <Link className="text-accent-text hover:underline" href={settingsHref}>
                Secrets
              </Link>{" "}
              before running.
            </>
          ) : (
            <>
              add {article(credentialTypeLabel(secret.credentialType))} under{" "}
              <Link className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
                Credentials
              </Link>
              , then bind it in{" "}
              <Link className="text-accent-text hover:underline" href={settingsHref}>
                Secrets
              </Link>{" "}
              before running.
            </>
          )}
        </FieldHint>
      ))}
      {!readOnly && slots.some((slot) => !node.credentials[slot.name]) ? (
        <div className="flex flex-wrap gap-1.5">
          {slots
            .filter((slot) => !node.credentials[slot.name])
            .map((slot) => (
              <Button key={slot.name} size="sm" onClick={() => setDeclaring(slot)}>
                Add a key for {slots.length > 1 ? humanizeSlot(slot.name) : "this step"}
              </Button>
            ))}
        </div>
      ) : null}
      <DeclareSecretDialog
        slot={declaring}
        taken={definition.secrets.map((x) => x.name)}
        sources={sources}
        {...(preferred ? { preferred } : {})}
        onClose={() => setDeclaring(null)}
        onDeclare={(slot, name, credentialType) => {
          store.getState().updateDefinition((d) => {
            // a key the server has (or none needed) is declared optional: the step runs on the
            // server key, or on a credential bound later, and removing the server key does not
            // block deploys of a workflow that can still bind one
            const fallback = keySource(credentialType, sources).kind;
            if (!d.secrets.some((x) => x.name === name))
              d.secrets.push({
                name,
                credentialType,
                required: fallback !== "server" && fallback !== "none",
              });
            const n = d.nodes.find((x) => x.id === node.id);
            if (n?.kind === "task") n.credentials[slot.name] = name;
          }, "Add a key");
          setDeclaring(null);
        }}
      />
    </div>
  );
}

function DeclareSecretDialog({
  slot,
  taken,
  sources,
  preferred,
  onClose,
  onDeclare,
}: {
  slot: CredentialSlot | null;
  taken: readonly string[];
  sources: KeySources;
  preferred?: string;
  onClose: () => void;
  onDeclare: (slot: CredentialSlot, name: string, credentialType: string) => void;
}) {
  return (
    <Dialog open={slot !== null} onOpenChange={(open) => !open && onClose()}>
      {slot ? (
        <DeclareSecretForm
          key={slot.name}
          slot={slot}
          taken={taken}
          sources={sources}
          {...(preferred ? { preferred } : {})}
          onClose={onClose}
          onDeclare={onDeclare}
        />
      ) : null}
    </Dialog>
  );
}

function DeclareSecretForm({
  slot,
  taken,
  sources,
  preferred,
  onClose,
  onDeclare,
}: {
  slot: CredentialSlot;
  taken: readonly string[];
  sources: KeySources;
  preferred?: string;
  onClose: () => void;
  onDeclare: (slot: CredentialSlot, name: string, credentialType: string) => void;
}) {
  // the chosen model's provider first, else the first type that already has a key
  const ready = slot.types.find((t) => keySource(t, sources).kind !== "missing");
  const initial = preferred && slot.types.includes(preferred) ? preferred : ready;
  const [type, setType] = useState(initial ?? slot.types[0] ?? "");
  const [name, setName] = useState(() => suggestSecretName(type, taken));
  const [edited, setEdited] = useState(false);
  const nameError = !SECRET_NAME.test(name)
    ? "Use capital letters, digits and _, starting with a letter (for example OPENAI_API_KEY)."
    : taken.includes(name)
      ? "This workflow already has a secret with that name."
      : undefined;
  return (
    <DialogContent size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!nameError && type) onDeclare(slot, name, type);
        }}
      >
        <DialogHeader>
          <DialogTitle>Add a key to this step</DialogTitle>
          <DialogDescription>
            The workflow keeps a named placeholder for the key, never the key itself. Each
            environment connects it to a saved credential; model providers can also use the key set
            on this server.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {slot.types.length > 1 ? (
            <FieldRow label="Which service?">
              <RadioGroup
                value={type}
                onValueChange={(t) => {
                  setType(t);
                  if (!edited) setName(suggestSecretName(t, taken));
                }}
                aria-label="Credential type"
              >
                {slot.types.map((t) => (
                  <RadioItem
                    key={t}
                    value={t}
                    label={credentialTypeLabel(t)}
                    meta={SOURCE_BADGE[keySource(t, sources).kind]}
                  />
                ))}
              </RadioGroup>
            </FieldRow>
          ) : (
            <p className="text-xs text-ink-2">
              {credentialTypeLabel(type)} · {SOURCE_BADGE[keySource(type, sources).kind]}
            </p>
          )}
          <FieldRow
            label="Name"
            hint="How nodes and environment settings refer to this key."
            error={nameError}
            required
          >
            <Input
              value={name}
              className="font-mono"
              onChange={(e) => {
                setEdited(true);
                setName(e.target.value.toUpperCase());
              }}
              aria-invalid={nameError ? true : undefined}
            />
          </FieldRow>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={Boolean(nameError) || !type}>
            Add key
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
