"use client";
/**
 * Compiles the draft in a Web Worker, debounced 150 ms after the last change (UI.md §4.1). Stale
 * results (an older request id) are dropped; without Worker support it compiles on the main thread.
 */
import { useEffect, useEffectEvent, useRef } from "react";
import type {
  NodeManifest,
  SubflowSignature,
  ToolDefinition,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { CompileResult } from "@flowaid/workflow-core";
import { compileLocal, type CompileRequest } from "./compileLocal";

export const COMPILE_DEBOUNCE_MS = 150;

export function useCompiler(
  definition: WorkflowDefinition,
  context: {
    manifests: readonly NodeManifest[];
    tools: readonly ToolDefinition[];
    subflows: Record<string, SubflowSignature | null>;
  } | null,
  onResult: (result: CompileResult) => void,
): void {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const emit = useEffectEvent((result: CompileResult) => onResult(result));

  useEffect(() => {
    try {
      const w = new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; result: CompileResult }>) => {
        if (e.data.id === seq.current) emit(e.data.result);
      };
      worker.current = w;
      return () => {
        w.terminate();
        worker.current = null;
      };
    } catch {
      worker.current = null;
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!context) return;
    const id = ++seq.current;
    const request: CompileRequest = { definition, ...context, level: "draft" };
    const t = setTimeout(() => {
      if (worker.current) worker.current.postMessage({ id, request });
      else {
        const result = compileLocal(request);
        if (id === seq.current) emit(result);
      }
    }, COMPILE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [definition, context]);
}
