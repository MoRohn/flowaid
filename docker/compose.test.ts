/**
 * Static guard for the compose stack (docker/compose.yml + compose.scale.yml), no Docker
 * needed: it parses the YAML (anchors and merge keys resolved) and asserts the security
 * properties the stack relies on.
 *
 * 1. Secret scope: `web` and the sandbox host `worker-code` have no `env_file` and receive only
 *    their allowed variables; neither sees `FLOWAID_MASTER_KEY*`, `*_API_KEY`, `S3_SECRET_KEY`
 *    or the owner's database password. `worker-code` connects as the `flowaid_code` role and
 *    has no `/data` mount.
 * 2. Hardening: `worker` and `worker-code` drop every capability and run with
 *    `no-new-privileges`; `worker-code` keeps its read-only root, tmpfs, pid and memory limits.
 * 3. Exposure: every published port binds `${BIND_ADDRESS:-127.0.0.1}`, the MinIO console is
 *    only published under the `tools` profile, `web` is only on the `edge` network and the
 *    `internal` network is `internal: true`.
 * 4. Defaults: no default password (`:?` for POSTGRES_PASSWORD, POSTGRES_CODE_PASSWORD and
 *    S3_SECRET_KEY; Redis checks REDIS_PASSWORD at start), `DB_RLS` defaults to true,
 *    `NODE_ENV` to production.
 * 5. Every image is pinned to a release tag and a sha256 digest, and every build uses the one
 *    docker/Dockerfile with a target.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DOCKER_DIR = dirname(fileURLToPath(import.meta.url));

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A scalar as compose would write it; containers are JSON so a mismatch reads clearly. */
function text(value: Json | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value ?? null);
}

function loadCompose(file: string): Record<string, Json> {
  const text = readFileSync(join(DOCKER_DIR, file), "utf8");
  const parsed: unknown = parse(text, { merge: true });
  if (!isRecord(parsed)) {
    throw new Error(`${file} is not a mapping`);
  }
  return parsed;
}

function services(compose: Record<string, Json>): Record<string, Record<string, Json>> {
  const out: Record<string, Record<string, Json>> = {};
  const section = compose["services"];
  if (!isRecord(section)) {
    throw new Error("compose file has no services");
  }
  for (const [name, service] of Object.entries(section)) {
    if (isRecord(service)) {
      out[name] = service;
    }
  }
  return out;
}

function service(name: string): Record<string, Json> {
  const found = STACK[name];
  if (found === undefined) {
    throw new Error(`service ${name} is not defined`);
  }
  return found;
}

/** `environment` as a name → raw value map (compose allows a map or a `KEY=value` list). */
function environmentOf(svc: Record<string, Json>): Record<string, string> {
  const env = svc["environment"];
  const out: Record<string, string> = {};
  if (isRecord(env)) {
    for (const [key, value] of Object.entries(env)) {
      out[key] = value === null ? "" : text(value);
    }
  } else if (Array.isArray(env)) {
    for (const entry of env) {
      const line = text(entry);
      const eq = line.indexOf("=");
      out[eq === -1 ? line : line.slice(0, eq)] = eq === -1 ? "" : line.slice(eq + 1);
    }
  }
  return out;
}

function stringList(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function networksOf(svc: Record<string, Json>): string[] {
  const networks = svc["networks"];
  if (Array.isArray(networks)) {
    return networks.map(text).sort();
  }
  return isRecord(networks) ? Object.keys(networks).sort() : [];
}

const MAIN = loadCompose("compose.yml");
const SCALE = loadCompose("compose.scale.yml");
/** The two files merged the way compose merges them: a service's keys, overlay winning. */
function mergeServices(
  base: Record<string, Record<string, Json>>,
  overlay: Record<string, Record<string, Json>>,
): Record<string, Record<string, Json>> {
  const out: Record<string, Record<string, Json>> = { ...base };
  for (const [name, svc] of Object.entries(overlay)) {
    out[name] = { ...(out[name] ?? {}), ...svc };
  }
  return out;
}

const STACK: Record<string, Record<string, Json>> = mergeServices(services(MAIN), services(SCALE));

const SECRET_NAME_RE =
  /^(FLOWAID_MASTER_KEY|FLOWAID_ADMIN_|FLOWAID_JWT_PRIVATE|OIDC_CLIENT_SECRET|S3_SECRET_KEY|.*_API_KEY$)/;

/** Variables the compose stack may hand to the web container (a subset is fine). */
const WEB_ALLOWED = new Set([
  "NODE_ENV",
  "HOSTNAME",
  "PORT",
  "FLOWAID_API_INTERNAL_URL",
  "NEXT_PUBLIC_FLOWAID_BASE_URL",
]);

/** Exactly the variables the sandbox host receives. */
const WORKER_CODE_ALLOWED = [
  "DATABASE_URL",
  "DB_RLS",
  "LOG_LEVEL",
  "NODE_ENV",
  "REDIS_URL",
  "SANDBOX_MODE",
  "WORKER_CONCURRENCY",
  "WORKER_POOLS",
];

const IMAGE_RE = /^[a-z0-9.\-/]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/;
const PUBLISHED_PORT_RE = /^\$\{BIND_ADDRESS:-127\.0\.0\.1\}:\$\{[A-Z_]+:-\d+\}:\d+$/;

describe("compose secret scope", () => {
  it("web has no env_file and only its allowed variables", () => {
    const web = service("web");
    expect(web["env_file"]).toBeUndefined();
    const names = Object.keys(environmentOf(web));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !WEB_ALLOWED.has(name))).toEqual([]);
    expect(names.filter((name) => SECRET_NAME_RE.test(name))).toEqual([]);
    expect(stringList(web["volumes"])).toEqual([]);
  });

  it("worker-code has no env_file, no /data mount and exactly its allowed variables", () => {
    const code = service("worker-code");
    expect(code["env_file"]).toBeUndefined();
    const env = environmentOf(code);
    expect(Object.keys(env).sort()).toEqual(WORKER_CODE_ALLOWED);
    expect(Object.keys(env).filter((name) => SECRET_NAME_RE.test(name))).toEqual([]);
    expect(env["WORKER_POOLS"]).toBe("code");
    expect(env["DATABASE_URL"]).toMatch(/^postgres:\/\/flowaid_code:\$\{POSTGRES_CODE_PASSWORD:\?/);
    // the owner's password is never interpolated into the sandbox host's connection string
    expect(env["DATABASE_URL"]).not.toContain("${POSTGRES_PASSWORD");
    expect(env["DATABASE_URL"]).not.toContain("${POSTGRES_APP_PASSWORD");
    expect(env["DB_RLS"]).toBe("${DB_RLS:-true}");
    expect(stringList(code["volumes"])).toEqual([]);
  });

  it("api and worker connect as flowaid_app; only the api holds the owner connection", () => {
    for (const name of ["api", "worker"]) {
      const env = environmentOf(service(name));
      expect(env["DATABASE_URL"], name).toMatch(/^postgres:\/\/flowaid_app:/);
      expect(env["DB_RLS"], name).toBe("${DB_RLS:-true}");
      expect(env["FLOWAID_MASTER_KEY"], name).toBe("${FLOWAID_MASTER_KEY:-}");
      expect(env["FLOWAID_MASTER_KEY_FILE"], name).toBe("/data/master.key");
      expect(service(name)["env_file"], `${name} reads .env`).toBeDefined();
    }
    expect(environmentOf(service("api"))["DATABASE_ADMIN_URL"]).toMatch(
      /^postgres:\/\/\$\{POSTGRES_USER:-flowaid\}:\$\{POSTGRES_PASSWORD:\?/,
    );
    expect(environmentOf(service("worker"))["DATABASE_ADMIN_URL"]).toBeUndefined();
  });
});

describe("compose hardening", () => {
  it("workers drop every capability and forbid privilege escalation", () => {
    for (const name of ["worker", "worker-code"]) {
      const svc = service(name);
      expect(stringList(svc["cap_drop"]), name).toEqual(["ALL"]);
      expect(stringList(svc["security_opt"]), name).toContain("no-new-privileges:true");
    }
    expect(service("worker")["pids_limit"]).toBe(1024);
  });

  it("worker-code keeps its read-only root, tmpfs and resource limits", () => {
    const code = service("worker-code");
    expect(code["read_only"]).toBe(true);
    expect(stringList(code["tmpfs"]).some((mount) => mount.startsWith("/tmp"))).toBe(true);
    const deploy = code["deploy"];
    const resources = isRecord(deploy) ? deploy["resources"] : undefined;
    const limits = isRecord(resources) ? resources["limits"] : undefined;
    expect(isRecord(limits) ? limits["memory"] : undefined).toBe("1g");
    const pids = code["pids_limit"] ?? (isRecord(limits) ? limits["pids"] : undefined);
    expect(pids).toBe(256);
  });

  it("api and web forbid privilege escalation", () => {
    for (const name of ["api", "web"]) {
      expect(stringList(service(name)["security_opt"]), name).toContain("no-new-privileges:true");
    }
  });
});

describe("compose exposure", () => {
  it("publishes every port on BIND_ADDRESS (loopback by default)", () => {
    const published: string[] = [];
    for (const [name, svc] of Object.entries(STACK)) {
      for (const port of stringList(svc["ports"])) {
        published.push(`${name}: ${port}`);
        expect(port, `${name} port`).toMatch(PUBLISHED_PORT_RE);
      }
    }
    expect(published.length).toBeGreaterThanOrEqual(6);
  });

  it("publishes the MinIO console only under the tools profile", () => {
    expect(stringList(service("minio")["ports"]).some((port) => port.endsWith(":9001"))).toBe(
      false,
    );
    const console = service("minio-console");
    expect(stringList(console["profiles"])).toEqual(["tools"]);
    expect(stringList(console["ports"]).some((port) => port.endsWith(":9001"))).toBe(true);
  });

  it("isolates web on the edge network and keeps the internal network internal", () => {
    const networks = MAIN["networks"];
    expect(isRecord(networks) ? networks["internal"] : undefined).toEqual({ internal: true });
    expect(networksOf(service("web"))).toEqual(["edge"]);
    expect(networksOf(service("api"))).toEqual(["edge", "internal"]);
    for (const name of ["postgres", "minio", "redis"]) {
      expect(networksOf(service(name)), name).not.toContain("edge");
      expect(networksOf(service(name)), name).toContain("internal");
    }
    expect(networksOf(service("minio-init"))).toEqual(["internal"]);
  });
});

describe("compose defaults", () => {
  it("has no default passwords", () => {
    const postgres = environmentOf(service("postgres"));
    expect(postgres["POSTGRES_PASSWORD"]).toMatch(/^\$\{POSTGRES_PASSWORD:\?/);
    expect(postgres["POSTGRES_CODE_PASSWORD"]).toMatch(/^\$\{POSTGRES_CODE_PASSWORD:\?/);
    expect(postgres["POSTGRES_APP_PASSWORD"]).toBe(
      "${POSTGRES_APP_PASSWORD:-${POSTGRES_PASSWORD}}",
    );
    expect(environmentOf(service("minio"))["MINIO_ROOT_PASSWORD"]).toMatch(/^\$\{S3_SECRET_KEY:\?/);
    expect(environmentOf(service("api"))["S3_SECRET_KEY"]).toMatch(/^\$\{S3_SECRET_KEY:\?/);
    const redis = service("redis");
    expect(environmentOf(redis)["REDIS_PASSWORD"]).toBe("${REDIS_PASSWORD:-}");
    const command = stringList(redis["command"]).join("\n");
    expect(command).toContain("${REDIS_PASSWORD:?");
    // `$$` is compose's escape for a literal `$` read by the container's shell
    expect(command).toContain('--requirepass "$$REDIS_PASSWORD"');
  });

  it("creates the database roles from docker/postgres-init", () => {
    expect(stringList(service("postgres")["volumes"])).toContain(
      "./postgres-init:/docker-entrypoint-initdb.d:ro",
    );
    const sql = readFileSync(join(DOCKER_DIR, "postgres-init", "01-roles.sql"), "utf8");
    expect(sql).toContain("CREATE ROLE flowaid_app LOGIN");
    expect(sql).toContain("CREATE ROLE flowaid_code LOGIN");
    expect(sql).toContain("\\getenv app_password POSTGRES_APP_PASSWORD");
    expect(sql).toContain("\\getenv code_password POSTGRES_CODE_PASSWORD");
    expect(sql).not.toMatch(/PASSWORD '[^:]/);
  });

  it("defaults NODE_ENV to production and DB_RLS to true for every flowaid process", () => {
    for (const name of ["api", "worker", "worker-code"]) {
      const env = environmentOf(service(name));
      expect(env["NODE_ENV"], name).toBe("${NODE_ENV:-production}");
      expect(env["DB_RLS"], name).toBe("${DB_RLS:-true}");
    }
    expect(environmentOf(service("web"))["NODE_ENV"]).toBe("production");
  });
});

describe("compose images and builds", () => {
  it("pins every image to a release tag and digest", () => {
    const images = Object.entries(STACK)
      .filter(([, svc]) => svc["build"] === undefined)
      .map(([name, svc]) => [name, text(svc["image"])] as const);
    expect(images.map(([name]) => name).sort()).toEqual(
      ["minio", "minio-console", "minio-init", "postgres", "redis"].sort(),
    );
    for (const [name, image] of images) {
      expect(image, name).toMatch(IMAGE_RE);
      expect(image, name).not.toMatch(/:latest@/);
    }
    expect(text(service("postgres")["image"])).toMatch(/^pgvector\/pgvector:\d+\.\d+\.\d+-pg16@/);
    expect(text(service("redis")["image"])).toMatch(/^redis:7\.\d+\.\d+-alpine@/);
    expect(text(service("minio")["image"])).toMatch(/\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T/);
    expect(text(service("minio-init")["image"])).toMatch(/\/mc:RELEASE\.\d{4}-\d{2}-\d{2}T/);
  });

  it("builds every app from docker/Dockerfile with a target", () => {
    const targets: Record<string, string> = {};
    for (const [name, svc] of Object.entries(STACK)) {
      const build = svc["build"];
      if (!isRecord(build)) {
        continue;
      }
      expect(build["context"], name).toBe("..");
      expect(build["dockerfile"], name).toBe("docker/Dockerfile");
      targets[name] = text(build["target"]);
    }
    expect(targets).toEqual({ api: "api", worker: "worker", "worker-code": "worker", web: "web" });
    const dockerfile = readFileSync(join(DOCKER_DIR, "Dockerfile"), "utf8");
    for (const target of ["api", "worker", "web", "vendor", "build"]) {
      expect(dockerfile).toMatch(new RegExp(`^FROM \\S+ AS ${target}$`, "m"));
    }
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:24\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toMatch(/^ARG PNPM_VERSION=12\.5\.1$/m);
    expect(dockerfile).toContain("ENV FLOWAID_VENDOR_DIR=/opt/flowaid/vendor");
    expect(dockerfile).toContain("sha256sum *.tgz > SHA256SUMS");
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
    expect(dockerfile).toContain("USER flowaid");
    expect(dockerfile).toContain("org.opencontainers.image.revision");
  });
});
