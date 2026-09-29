/**
 * The `./flowaid` launcher's control channel as the API calls it (scripts/control.ts): what the
 * launcher manages (FlowAId's window, its menu bar icon), closing that window, and quitting the
 * whole application. The launcher listens on this computer only and checks a bearer token
 * generated for each launch (FLOWAID_LAUNCHER_URL/TOKEN).
 */
import { count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { humanTasks, runs, type Database } from "@flowaid/database";
import { ApiError } from "../plugins/errors.js";

export const ActivitySchema = z.object({
  /** runs executing now: queued, starting, running or retrying (not waiting for a timer or a person) */
  runs: z.int(),
  /** human tasks waiting for someone */
  approvals: z.int(),
});
export type Activity = z.infer<typeof ActivitySchema>;

/** What FlowAId is doing in the background, across workspaces: what quitting would interrupt. */
export function activityCounts(db: Database): Promise<Activity> {
  return db.system(async (tx) => {
    const [r] = await tx
      .select({ n: count() })
      .from(runs)
      .where(inArray(runs.status, ["queued", "starting", "running", "retrying"]));
    const [h] = await tx
      .select({ n: count() })
      .from(humanTasks)
      .where(eq(humanTasks.status, "open"));
    return { runs: r?.n ?? 0, approvals: h?.n ?? 0 };
  });
}

export const LauncherStatusSchema = z.object({
  /** `app`: FlowAId's own app window, which the launcher can close; `browser`: a tab in the default browser; `none`: no window (not a desktop session, or `--no-open`) */
  window: z.enum(["app", "browser", "none"]),
  /** the menu bar (tray) icon that reopens the window or quits is showing */
  tray: z.boolean(),
  platform: z.enum(["macos", "windows", "linux", "other"]),
});
export type LauncherStatus = z.infer<typeof LauncherStatusSchema>;

export class LauncherClient {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(o: { url: string; token: string; fetch?: typeof fetch }) {
    this.url = o.url.replace(/\/+$/, "");
    this.token = o.token;
    this.fetchImpl = o.fetch ?? fetch;
  }

  private async call(method: "GET" | "POST", path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new ApiError(
        503,
        "LAUNCHER_UNAVAILABLE",
        `the FlowAId launcher did not answer: ${(error as Error).message}`,
        true,
      );
    }
    if (!res.ok)
      throw new ApiError(502, "LAUNCHER_ERROR", `the FlowAId launcher answered ${res.status}`);
    return res.json();
  }

  async status(): Promise<LauncherStatus> {
    return LauncherStatusSchema.parse(await this.call("GET", "/status"));
  }

  /** False when the launcher owns no window to close (FlowAId is in a browser tab). */
  async closeWindow(): Promise<boolean> {
    const body = z.object({ closed: z.boolean() }).parse(await this.call("POST", "/window/close"));
    return body.closed;
  }

  /** The launcher answers first, then stops the web app, the worker and this API. */
  async quit(): Promise<void> {
    await this.call("POST", "/quit");
  }

  /** Tells the menu bar icon what runs in the background. */
  async activity(a: Activity): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/activity`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(a),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`the FlowAId launcher answered ${res.status}`);
  }
}

/**
 * Reports the activity to the launcher every `everyMs` (and at once), so its icon shows what runs
 * while the window is closed. A launcher that does not answer is skipped until the next report.
 */
export function startActivityReports(
  db: Database,
  launcher: Pick<LauncherClient, "activity">,
  o: { everyMs?: number; onError?: (error: unknown) => void } = {},
): () => void {
  let last = "";
  let unchanged = 0;
  let busy = false;
  const report = async () => {
    if (busy) return;
    busy = true;
    try {
      const a = await activityCounts(db);
      const key = JSON.stringify(a);
      // unchanged, the icon already shows it; it is still sent every sixth report (a launcher
      // that restarted its icon catches up)
      if (key !== last || unchanged >= 5) {
        await launcher.activity(a);
        last = key;
        unchanged = 0;
      } else unchanged += 1;
    } catch (error) {
      o.onError?.(error);
    } finally {
      busy = false;
    }
  };
  void report();
  const timer = setInterval(() => void report(), o.everyMs ?? 10_000);
  timer.unref();
  return () => clearInterval(timer);
}
