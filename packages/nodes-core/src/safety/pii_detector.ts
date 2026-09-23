import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { PII_KINDS, detectPii, redactPii, type PiiKind } from "./pii.js";

export const piiDetectorNode = defineNode({
  id: "flowaid.safety.pii_detector",
  version: "1.0.0",
  metadata: {
    name: "PII detector",
    description:
      "Finds personal data (emails, phone numbers, card numbers with a Luhn check, SSNs, IBANs with a mod-97 check, IP addresses, API keys) and optionally redacts it. Fires `clean` or `found`.",
    category: "safety",
    icon: "scan-eye",
    tags: ["safety", "privacy", "pii", "redaction"],
    summary: "{{ config.action }}",
  },
  configSchema: z.strictObject({
    kinds: z
      .array(z.enum(PII_KINDS as [PiiKind, ...PiiKind[]]))
      .min(1)
      .default([...PII_KINDS])
      .meta({ "x-ui": { widget: "list" } }),
    action: z
      .enum(["detect", "redact"])
      .default("redact")
      .meta({ "x-ui": { widget: "select" } }),
    style: z
      .enum(["label", "mask"])
      .default("label")
      .meta({ "x-ui": { widget: "select", showWhen: { path: "/action", oneOf: ["redact"] } } }),
  }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({
    text: z
      .string()
      .meta({ "x-port": { description: "The input, redacted when action = redact." } }),
    found: z.boolean(),
    findings: z.array(
      z.object({ kind: z.string(), start: z.int(), end: z.int(), preview: z.string() }),
    ),
    counts: z.record(z.string(), z.int()),
  }),
  controlPorts: [
    { name: "clean", label: "Clean", description: "No personal data found." },
    { name: "found", label: "Found", description: "At least one finding." },
  ],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const findings = detectPii(input.text, ctx.config.kinds);
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    const text =
      ctx.config.action === "redact"
        ? redactPii(input.text, findings, ctx.config.style)
        : input.text;
    const found = findings.length > 0;
    return Promise.resolve(
      ok({ text, found, findings, counts }, { route: found ? "found" : "clean" }),
    );
  },
});
