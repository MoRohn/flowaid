/** Test harness: a migrated disposable database, first boot, and a server over it. */
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { PgEventBus, PgQueueDriver } from "@flowaid/database";
import { createTestDatabase, type TestDatabase } from "@flowaid/database/testing";
import { randomBytes } from "node:crypto";
import { envMasterKey } from "@flowaid/credentials";
import { createSafeFetch } from "@flowaid/providers";
import { RunEventHub } from "../services/hub.js";
import { createCredentialService } from "../services/credentials.js";
import { AuthService } from "../auth/service.js";
import { JwtKeys } from "../auth/jwt.js";
import { firstBoot } from "../bootstrap/firstBoot.js";
import { defaultConfig, type ApiConfig, type ApiContext } from "../context.js";
import { buildServer, type BuildOptions } from "../server.js";

export const OWNER = { email: "owner@example.com", password: "Correct-Horse-9" };

export interface TestApp {
  app: FastifyInstance;
  ctx: ApiContext;
  db: TestDatabase;
  clock: { t: number; now(): number };
  close(): Promise<void>;
}

export async function createTestApp(
  config: Partial<ApiConfig> = {},
  o: BuildOptions = {},
): Promise<TestApp> {
  const db = await createTestDatabase();
  const keys = (await JwtKeys.generate()).keys;
  const clock = {
    t: Date.now(),
    now() {
      return this.t;
    },
  };
  const queue = new PgQueueDriver(db.app.sql, { pollMs: 50 });
  const hub = new RunEventHub(new PgEventBus(db.app.sql));
  const ctx: ApiContext = {
    config: defaultConfig({ allowPrivateNetwork: true, ...config }),
    db: db.app,
    keys,
    auth: new AuthService(db.app, keys, () => clock.now()),
    clock,
    queue,
    hub,
    credentials: await createCredentialService(
      db.app,
      envMasterKey(randomBytes(32).toString("base64")),
    ),
    http: createSafeFetch({ allowPrivate: config.allowPrivateNetwork ?? true }),
  };
  await firstBoot(db.app, { adminEmail: OWNER.email, adminPassword: OWNER.password });
  const app = await buildServer(ctx, o);
  await app.ready();
  return {
    app,
    ctx,
    db,
    clock,
    close: async () => (await app.close(), await hub.close(), await queue.close(), await db.drop()),
  };
}

/** A cookie jar that follows Set-Cookie across injected requests (Path-aware for the refresh cookie). */
export class Jar {
  private readonly cookies = new Map<string, { value: string; path: string }>();
  take(res: LightMyRequestResponse): void {
    for (const c of res.cookies as {
      name: string;
      value: string;
      path?: string;
      maxAge?: number;
      expires?: Date;
    }[]) {
      const expired =
        c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now());
      if (expired || c.value === "") this.cookies.delete(c.name);
      else this.cookies.set(c.name, { value: c.value, path: c.path ?? "/" });
    }
  }
  header(url: string): string {
    return [...this.cookies]
      .filter(([, c]) => url.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join("; ");
  }
  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }
}

export async function login(app: FastifyInstance, jar = new Jar(), creds = OWNER): Promise<Jar> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: creds });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  jar.take(res);
  return jar;
}

/** Inject with the jar's cookies and the CSRF header. */
export async function call(
  app: FastifyInstance,
  jar: Jar | null,
  method: string,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.inject({
    method: method as never,
    url,
    ...(payload !== undefined ? { payload: payload as never } : {}),
    headers: {
      ...(jar ? { cookie: jar.header(url), "x-requested-with": "flowaid" } : {}),
      ...headers,
    },
  });
  jar?.take(res);
  return res;
}
