/// <reference lib="webworker" />
/** The compiler off the main thread: one request in, one result out (tagged with its id). */
import { compileLocal, type CompileRequest } from "./compileLocal";

self.onmessage = (event: MessageEvent<{ id: number; request: CompileRequest }>) => {
  const { id, request } = event.data;
  try {
    const result = compileLocal(request);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      result: {
        ok: false,
        diagnostics: [
          {
            code: "E_INTERNAL",
            severity: "error",
            message: `Compiler error: ${error instanceof Error ? error.message : String(error)}`,
            location: {},
          },
        ],
      },
    });
  }
};
