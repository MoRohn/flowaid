import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError, NetworkError } from "@flowaid/workflow-core";
import { errorFromResponse } from "@flowaid/providers";
import { openaiEndpoint } from "../common.js";

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

/** Audio container from its first bytes, for the uploaded file name. */
export function audioExtension(bytes: Uint8Array): string {
  const s = String.fromCharCode(...bytes.slice(0, 12));
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WAVE") return "wav";
  if (s.startsWith("OggS")) return "ogg";
  if (s.startsWith("fLaC")) return "flac";
  if (s.startsWith("ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  if (s.slice(4, 8) === "ftyp") return "m4a";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "webm";
  return "mp3";
}

export const speechNode = defineNode({
  id: "flowaid.ai.speech",
  version: "1.0.0",
  metadata: {
    name: "Speech",
    description:
      "Transcribes audio to text, or synthesises speech from text into an audio artifact, with an OpenAI-compatible /audio endpoint.",
    category: "generation",
    icon: "audio-lines",
    tags: ["audio", "speech", "transcription", "tts"],
    summary: "{{ config.mode }} {{ config.model }}",
  },
  configSchema: z.strictObject({
    mode: z
      .enum(["transcribe", "synthesize"])
      .default("transcribe")
      .meta({ "x-ui": { widget: "select" } }),
    model: z
      .string()
      .min(1)
      .max(200)
      .default("gpt-4o-mini-transcribe")
      .meta({
        "x-ui": { help: "e.g. gpt-4o-mini-transcribe or whisper-1; gpt-4o-mini-tts or tts-1." },
      }),
    language: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional()
      .meta({ "x-ui": { showWhen: { path: "/mode", equals: "transcribe" } } }),
    voice: z
      .string()
      .min(1)
      .max(100)
      .default("alloy")
      .meta({ "x-ui": { showWhen: { path: "/mode", equals: "synthesize" } } }),
    format: z
      .enum(["mp3", "opus", "aac", "flac", "wav", "pcm"])
      .default("mp3")
      .meta({ "x-ui": { widget: "select", showWhen: { path: "/mode", equals: "synthesize" } } }),
  }),
  inputSchema: z.object({
    audio: z.object({ $artifact: z.string().min(1) }).optional(),
    text: z.string().max(4096).optional(),
  }),
  outputSchema: z.object({
    text: z.string().nullable(),
    audio: z.object({ $artifact: z.string() }).nullable(),
  }),
  credentials: [{ name: "llm", types: ["openai.api_key"], required: true }],
  capabilities: ["network", "credentials", "artifacts"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 180000 },
  execute: async (ctx, input) => {
    const { base, headers } = openaiEndpoint(await ctx.credentials.get("llm"));
    const call = async (path: string, init: RequestInit) => {
      let res: Response;
      try {
        res = await ctx.http(`${base}${path}`, { ...init, signal: ctx.signal });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        throw new NetworkError(
          `${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!res.ok) throw errorFromResponse("openai", res.status, res.headers, await res.text());
      return res;
    };
    if (ctx.config.mode === "transcribe") {
      if (!input.audio) throw new BadRequestError("bind audio to transcribe");
      const bytes = await ctx.artifacts.get(input.audio.$artifact);
      const ext = audioExtension(bytes);
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(bytes)]), `audio.${ext}`);
      form.set("model", ctx.config.model);
      form.set("response_format", "json");
      if (ctx.config.language) form.set("language", ctx.config.language.slice(0, 2));
      const res = await call("/audio/transcriptions", { method: "POST", headers, body: form });
      const body = (await res.json()) as { text?: unknown };
      if (typeof body.text !== "string")
        throw new NetworkError("the transcription response has no text");
      return ok({ text: body.text, audio: null });
    }
    if (!input.text) throw new BadRequestError("bind text to synthesize");
    const res = await call("/audio/speech", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: ctx.config.model,
        input: input.text,
        voice: ctx.config.voice,
        response_format: ctx.config.format,
      }),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ref = await ctx.artifacts.put(
      `speech.${ctx.config.format}`,
      bytes,
      AUDIO_MIME[ctx.config.format] ?? "application/octet-stream",
    );
    return ok({ text: null, audio: ref });
  },
});
