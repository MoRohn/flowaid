"use client";
/**
 * The PageIndex part of the new-source form: the indexing model, its key, the build mode and the
 * tree optimization, then how the documents are processed (shown before the source is created).
 */
import { useId } from "react";
import { FieldRow, Input, RadioGroup, RadioItem, Select, SelectItem } from "@flowaid/ui/primitives";
import type { Credential, ModelInfo, Provider } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import type { SourceForm } from "../model";
import {
  DEFAULT_INDEX_MODEL,
  INDEX_PROVIDERS,
  PROCESSING,
  credentialTypeOf,
  indexModelsOf,
  OPTIMIZE_LABEL,
  isIndexProvider,
} from "./model";

const SERVER_KEY = "__server";

export function PageIndexSourceFields({
  form,
  set,
  credentials,
  models,
  providers,
  ws,
}: {
  form: SourceForm;
  set: <K extends keyof SourceForm>(k: K, v: SourceForm[K]) => void;
  credentials: readonly Credential[];
  models: readonly ModelInfo[];
  providers: readonly Provider[];
  ws: string;
}) {
  const listId = useId();
  const provider = form.indexProvider;
  const known = indexModelsOf(models, provider);
  const matching = credentials.filter((c) => c.type === credentialTypeOf(provider));
  const serverReady = providers.some((p) => p.id === provider && p.configuredOnServer);
  const ready = serverReady || form.indexCredentialId !== null;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Indexing model provider" htmlFor="ks-index-provider">
            <Select
              id="ks-index-provider"
              value={provider}
              onValueChange={(v) => {
                if (!isIndexProvider(v)) return;
                set("indexProvider", v);
                set("indexModel", indexModelsOf(models, v)[0] ?? DEFAULT_INDEX_MODEL[v]);
                set("indexCredentialId", null);
              }}
            >
              {INDEX_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {providerName(p)}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          <FieldRow
            label="Indexing model"
            htmlFor="ks-index-model"
            hint="Writes the section summaries"
            required
          >
            <Input
              id="ks-index-model"
              value={form.indexModel}
              maxLength={200}
              list={known.length ? listId : undefined}
              onChange={(e) => set("indexModel", e.target.value)}
              placeholder={DEFAULT_INDEX_MODEL[provider]}
              autoComplete="off"
            />
          </FieldRow>
          {known.length ? (
            <datalist id={listId}>
              {known.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          ) : null}
          <FieldRow
            label="Credential"
            htmlFor="ks-index-credential"
            hint={`A ${providerName(provider)} credential of this workspace`}
            className="sm:col-span-2"
          >
            <Select
              id="ks-index-credential"
              value={form.indexCredentialId ?? SERVER_KEY}
              onValueChange={(v) => set("indexCredentialId", v === SERVER_KEY ? null : v)}
            >
              <SelectItem value={SERVER_KEY}>
                {provider === "ollama" ? "Use the server's Ollama host" : "Use the server key"}
              </SelectItem>
              {matching.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
        </div>
        {!ready && providers.length > 0 ? (
          <p role="status" className="text-xs text-warn-text">
            {providerName(provider)} is not configured on the server and no credential is chosen, so
            indexing will fail.{" "}
            <a className="underline" href={`/${ws}/credentials`}>
              Add a credential
            </a>{" "}
            or pick another provider.
          </p>
        ) : null}
        <FieldRow label="Build the tree">
          <RadioGroup
            value={form.indexMode}
            onValueChange={(v) => set("indexMode", v === "standard" ? "standard" : "flash")}
            aria-label="Build the tree"
          >
            <RadioItem
              value="flash"
              label="Flash (layout-based)"
              description="Sections come from the PDF's layout and headings; the model only writes summaries. Faster and cheaper."
            />
            <RadioItem
              value="standard"
              label="Standard (built by the model)"
              description="The model reads the pages and builds the section tree. Slower and uses more tokens."
            />
          </RadioGroup>
        </FieldRow>
        <FieldRow
          label="Tree optimization"
          htmlFor="ks-index-optimize"
          hint="How the tree is tidied after it is built"
          className="sm:max-w-80"
        >
          <Select
            id="ks-index-optimize"
            value={form.indexOptimize}
            onValueChange={(v) => set("indexOptimize", v === "full" || v === "merge" ? v : "off")}
          >
            {(["off", "merge", "full"] as const).map((o) => (
              <SelectItem key={o} value={o}>
                {OPTIMIZE_LABEL[o]}
              </SelectItem>
            ))}
          </Select>
        </FieldRow>
      </div>
      <section
        aria-labelledby="ks-processing"
        className="flex flex-col gap-1.5 rounded-md border border-info/40 bg-info-soft px-3 py-2 text-xs text-info-text"
      >
        <h3 id="ks-processing" className="font-semibold">
          How documents are processed
        </h3>
        <p>{PROCESSING.local}</p>
        <p>{PROCESSING.cloud}</p>
      </section>
    </>
  );
}
