/**
 * What the pinned PageIndex release can do in each mode (verified against pageindex 0.2.20's
 * source; docs/pageindex/CAPABILITIES.md). The UI and validation read this; nothing offers a
 * capability the table does not list.
 */
import { sha256Hex } from "@flowaid/shared";
import type { DocumentIndexCapabilities, ModelRef } from "@flowaid/workflow-core";

/** The SDK release the service pins (apps/pageindex/requirements.lock). */
export const PAGEINDEX_SDK_VERSION = "0.2.20";

/** Local mode: the open-source pipeline on this machine. PDFs with a text layer only. */
export const LOCAL_CAPABILITIES: DocumentIndexCapabilities = {
  formats: ["application/pdf"],
  pageLocators: "physical",
  pageLabels: false,
  blocks: false,
  ocr: false,
};

export const MODES = {
  local: {
    available: true,
    capabilities: LOCAL_CAPABILITIES,
    processing:
      "Files are parsed on the machine running the FlowAId PageIndex service. Section summaries are written by the indexing model you choose, so page text is sent to that model's provider (nothing leaves this machine when the model is Ollama here).",
  },
  cloud: {
    available: false,
    capabilities: null,
    processing:
      "PageIndex cloud (managed OCR, block-level citations) is not enabled in this release: it could not be verified without cloud credentials. Documents are never uploaded to it.",
  },
} as const;

/** The indexing model as LiteLLM names it (the SDK routes model calls through LiteLLM). */
export function litellmModel(ref: ModelRef): string {
  switch (ref.provider) {
    case "openai":
    case "anthropic":
    case "ollama":
      return `${ref.provider}/${ref.model}`;
    default:
      throw new Error(
        `PageIndex indexing supports OpenAI, Anthropic and Ollama models; ${ref.provider} is not one`,
      );
  }
}

export interface IndexSettings {
  model: ModelRef;
  mode: "flash" | "standard";
  optimize: "merge" | "full" | "off";
}

/** Identity of an index's configuration: equal hashes over the same bytes are the same index. */
export function configHash(s: IndexSettings): string {
  return sha256Hex(
    JSON.stringify({
      backend: "pageindex",
      sdk: PAGEINDEX_SDK_VERSION,
      model: `${s.model.provider}/${s.model.model}`,
      mode: s.mode,
      optimize: s.optimize,
    }),
  ).slice(0, 32);
}
