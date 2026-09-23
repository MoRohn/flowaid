import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { detectPii } from "./pii.js";

/** Common prompt-injection phrasings (case-insensitive); a heuristic first line, not a guarantee. */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)\b/i,
  /\bdisregard (?:all |any |the )?(?:previous|prior|above|system) (?:instructions|prompts?|messages?)\b/i,
  /\byou are now (?:in )?(?:developer|dan|jailbreak|unrestricted) mode\b/i,
  /\b(?:reveal|print|show|repeat) (?:your|the) (?:system|hidden|initial) (?:prompt|instructions)\b/i,
  /<\/?(?:system|assistant)>|\[\/?INST\]|<\|im_(?:start|end)\|>/i,
];

export interface GuardViolation {
  rule: "max_length" | "min_length" | "deny" | "allow" | "injection" | "pii";
  detail: string;
}

export const guardNode = defineNode({
  id: "flowaid.safety.guard",
  version: "1.0.0",
  metadata: {
    name: "Guard",
    description:
      "Deterministic input/output checks: length bounds, deny and allow patterns, prompt-injection heuristics and PII presence. Fires `pass` or `block` with every violation listed.",
    category: "safety",
    icon: "shield",
    tags: ["safety", "guardrail", "injection"],
    summary: "guard",
  },
  configSchema: z.strictObject({
    maxLength: z.int().min(1).optional(),
    minLength: z.int().min(0).optional(),
    deny: z
      .array(z.string().min(1).max(1000))
      .max(100)
      .default([])
      .meta({ "x-ui": { help: "Regular expressions that block when they match." } }),
    allow: z
      .array(z.string().min(1).max(1000))
      .max(100)
      .default([])
      .meta({ "x-ui": { help: "When set, the text must match at least one." } }),
    caseInsensitive: z
      .boolean()
      .default(true)
      .meta({ "x-ui": { widget: "switch" } }),
    detectInjection: z
      .boolean()
      .default(true)
      .meta({ "x-ui": { widget: "switch" } }),
    blockPii: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
  }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({
    text: z.string(),
    passed: z.boolean(),
    violations: z.array(z.object({ rule: z.string(), detail: z.string() })),
  }),
  controlPorts: [
    { name: "pass", label: "Pass", description: "No rule was violated." },
    { name: "block", label: "Block", description: "At least one rule was violated." },
  ],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const { text } = input;
    const c = ctx.config;
    const flags = c.caseInsensitive ? "iu" : "u";
    const violations: GuardViolation[] = [];
    const length = [...text].length;
    if (c.maxLength !== undefined && length > c.maxLength)
      violations.push({ rule: "max_length", detail: `${length} > ${c.maxLength} characters` });
    if (c.minLength !== undefined && length < c.minLength)
      violations.push({ rule: "min_length", detail: `${length} < ${c.minLength} characters` });
    for (const p of c.deny)
      if (new RegExp(p, flags).test(text)) violations.push({ rule: "deny", detail: p });
    if (c.allow.length > 0 && !c.allow.some((p) => new RegExp(p, flags).test(text)))
      violations.push({ rule: "allow", detail: "matched no allow pattern" });
    if (c.detectInjection)
      for (const re of INJECTION_PATTERNS)
        if (re.test(text)) violations.push({ rule: "injection", detail: re.source });
    if (c.blockPii)
      for (const f of detectPii(text))
        violations.push({ rule: "pii", detail: `${f.kind} at ${f.start}` });
    const passed = violations.length === 0;
    return Promise.resolve(ok({ text, passed, violations }, { route: passed ? "pass" : "block" }));
  },
});
