import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError, type JsonObject, type JsonValue } from "@flowaid/workflow-core";
import { casUpdate, readVersioned } from "./cas.js";

interface SessionData {
  turns: JsonValue[];
  expiresAt: number | null;
  lastKey?: string;
}

function sessionData(raw: JsonValue | undefined, now: number): SessionData {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const expiresAt = typeof d.expiresAt === "number" ? d.expiresAt : null;
  // an expired session reads as empty; the next append starts it again
  if (expiresAt !== null && expiresAt <= now) return { turns: [], expiresAt: null };
  return {
    turns: Array.isArray(d.turns) ? d.turns : [],
    expiresAt,
    ...(typeof d.lastKey === "string" ? { lastKey: d.lastKey } : {}),
  };
}

export const sessionNode = defineNode({
  id: "flowaid.state.session",
  version: "1.0.0",
  metadata: {
    name: "Session memory",
    description:
      "Conversation memory for the run's session: appends a turn and/or reads the last N turns, with a sliding time-to-live. Appends are safe under concurrent runs of the same session.",
    category: "state",
    icon: "messages-square",
    tags: ["state", "memory", "conversation"],
    summary: "{{ config.op }} {{ config.key }}",
  },
  configSchema: z.strictObject({
    op: z
      .enum(["append", "read", "append_and_read"])
      .default("append_and_read")
      .meta({ "x-ui": { widget: "select" } }),
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,63}$/)
      .default("conversation"),
    lastN: z.int().min(1).max(500).default(20),
    maxTurns: z
      .int()
      .min(1)
      .max(10_000)
      .default(200)
      .meta({ "x-ui": { help: "Older turns are dropped beyond this many." } }),
    ttlMs: z
      .int()
      .min(60_000)
      .max(31_536_000_000)
      .optional()
      .meta({ "x-ui": { help: "The session is forgotten this long after its last append." } }),
  }),
  inputSchema: z.object({ turn: z.unknown().optional() }),
  outputSchema: z.object({ turns: z.array(z.unknown()), count: z.int().min(0) }),
  capabilities: ["state"],
  idempotency: "keyed",
  defaultPolicy: { timeoutMs: 10000 },
  execute: async (ctx, input) => {
    if (!ctx.run.sessionId)
      throw new BadRequestError(
        "session memory needs a run with a sessionId (pass sessionId when starting it)",
      );
    const { op, key, lastN, maxTurns, ttlMs } = ctx.config;
    const now = ctx.clock.now().getTime();
    const stateKey = `session:${key}`;
    let turns: JsonValue[];
    if (op === "read") {
      turns = sessionData(readVersioned(await ctx.state.get("session", stateKey))?.data, now).turns;
    } else {
      if (input.turn === undefined) throw new BadRequestError("bind turn to append");
      const turn = input.turn as JsonValue;
      const idem = ctx.node.idempotencyKey;
      const { value } = await casUpdate(ctx, "session", stateKey, (current) => {
        const data = sessionData(current?.data, now);
        // a retry of the same node run does not append twice
        if (idem && data.lastKey === idem) return undefined;
        const next: JsonObject = {
          turns: [...data.turns, turn].slice(-maxTurns),
          expiresAt: ttlMs !== undefined ? now + ttlMs : null,
        };
        if (idem) next.lastKey = idem;
        return next;
      });
      turns = sessionData(value?.data, now).turns;
    }
    const last = turns.slice(-lastN);
    return ok({ turns: last, count: turns.length });
  },
});
