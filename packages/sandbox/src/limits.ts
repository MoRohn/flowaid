/** Limits shared by the executors (ARCHITECTURE.md §10.7). */
export const SANDBOX_LIMITS = {
  /** default isolate heap */
  memoryMb: 128,
  /** hard wall-clock ceiling for any run */
  maxWallClockMs: 120_000,
  /** every value crossing the bridge (inputs, callback args and results, the output) */
  bridgeBytes: 4 * 1024 * 1024,
  logLines: 1000,
  logLineBytes: 8 * 1024,
  /** stdout/stderr kept from a container */
  streamBytes: 4 * 1024 * 1024,
} as const;
