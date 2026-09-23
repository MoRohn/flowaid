/**
 * Live guard for the compose stack: resolves docker/compose*.yml with `docker compose config`
 * (the same code path `docker compose up` uses) and checks what a Docker parse alone cannot:
 *
 * 1. The stack resolves with its pinned digests and the `:?` passwords provided.
 * 2. The environment of every flowaid process (`api`, `worker`, `worker-code`) passes
 *    `safeLoadEnv()` from @flowaid/env, so a variable that compose sets and the schema rejects
 *    (or the reverse) fails here instead of at container start.
 * 3. `web` and `worker-code` receive no secret.
 * 4. The build context of docker/Dockerfile excludes `.git`, `node_modules` and every `.env*`
 *    file except `.env.example` (.dockerignore), verified by exporting the context.
 *
 * Skipped when Docker (compose v2) is not available.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative like scripts/gen-env-example.ts: the root project is not a workspace package.
import { safeLoadEnv } from "../packages/env/src/index.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const REQUIRED = {
  POSTGRES_PASSWORD: "test-owner-password",
  POSTGRES_CODE_PASSWORD: "test-code-password",
  S3_SECRET_KEY: "test-s3-secret",
};

/**
 * Runs docker with a clean environment (only PATH, HOME and the DOCKER_* client settings), so
 * that compose interpolates `${...}` from the `--env-file` alone and a developer's shell (or
 * vitest's `NODE_ENV=test`) cannot change what the stack resolves to.
 */
const CLEAN_DOCKER =
  'exec env -i PATH="$PATH" HOME="$HOME" ' +
  '${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} ${DOCKER_CONTEXT:+DOCKER_CONTEXT="$DOCKER_CONTEXT"} ' +
  '${DOCKER_CONFIG:+DOCKER_CONFIG="$DOCKER_CONFIG"} ${DOCKER_CERT_PATH:+DOCKER_CERT_PATH="$DOCKER_CERT_PATH"} ' +
  '${DOCKER_TLS_VERIFY:+DOCKER_TLS_VERIFY="$DOCKER_TLS_VERIFY"} docker "$@"';

function docker(
  args: string[],
  options: { input?: string } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("sh", ["-c", CLEAN_DOCKER, "docker", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    input: options.input,
  });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

const HAS_DOCKER = docker(["compose", "version"]).ok && docker(["info"]).ok;

interface ComposeService {
  readonly environment?: Record<string, string | null>;
  readonly image?: string;
  readonly env_file?: unknown;
}

interface ComposeProject {
  readonly services: Record<string, ComposeService>;
}

function isComposeProject(value: unknown): value is ComposeProject {
  return (
    typeof value === "object" &&
    value !== null &&
    "services" in value &&
    typeof value.services === "object" &&
    value.services !== null
  );
}

function environmentOf(svc: ComposeService): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(svc.environment ?? {})) {
    out[key] = value ?? "";
  }
  return out;
}

describe.skipIf(!HAS_DOCKER)("docker compose config", () => {
  let workDir = "";
  let project: ComposeProject = { services: {} };
  let scaleProject: ComposeProject = { services: {} };

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "flowaid-compose-"));
    const envFile = join(workDir, "compose.env");
    writeFileSync(
      envFile,
      Object.entries(REQUIRED)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    // --no-env-resolution keeps a developer's real ../.env out of the resolved environment.
    const base = [
      "compose",
      "--env-file",
      envFile,
      "config",
      "--format",
      "json",
      "--no-env-resolution",
    ];
    const main = docker(base);
    expect(main.ok, main.stderr).toBe(true);
    const parsed: unknown = JSON.parse(main.stdout);
    if (!isComposeProject(parsed)) {
      throw new Error("docker compose config did not return a project");
    }
    project = parsed;
    const scale = docker([
      ...base.slice(0, 1),
      "--profile",
      "scale",
      "--profile",
      "tools",
      ...base.slice(1),
    ]);
    expect(scale.ok, scale.stderr).toBe(true);
    const parsedScale: unknown = JSON.parse(scale.stdout);
    if (!isComposeProject(parsedScale)) {
      throw new Error("docker compose config (profiles) did not return a project");
    }
    scaleProject = parsedScale;
  });

  afterAll(() => {
    if (workDir !== "") {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("resolves the default stack and the scale/tools profiles with pinned digests", () => {
    expect(Object.keys(project.services).sort()).toEqual(
      ["api", "minio", "minio-init", "postgres", "web", "worker", "worker-code"].sort(),
    );
    expect(Object.keys(scaleProject.services)).toContain("redis");
    expect(Object.keys(scaleProject.services)).toContain("minio-console");
    for (const [name, svc] of Object.entries(scaleProject.services)) {
      if (svc.image !== undefined && !svc.image.startsWith("flowaid/")) {
        expect(svc.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
    }
  });

  it("refuses to start without the passwords", () => {
    const result = docker(["compose", "--env-file", "/dev/null", "config", "--quiet"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/POSTGRES_PASSWORD|POSTGRES_CODE_PASSWORD|S3_SECRET_KEY/);
  });

  it.each(["api", "worker", "worker-code"])("%s environment passes safeLoadEnv()", (name) => {
    const svc = project.services[name];
    expect(svc, name).toBeDefined();
    const env = environmentOf(svc ?? {});
    const result = safeLoadEnv(env);
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.flags.isProduction).toBe(true);
    expect(result.value.DB_RLS).toBe(true);
    if (name === "worker-code") {
      expect(result.value.WORKER_POOLS).toEqual(["code"]);
      expect(result.value.flags.hasMasterKeyInEnv).toBe(false);
      expect(result.value.flags.hasS3).toBe(false);
      expect(result.value.DATABASE_URL).toContain("flowaid_code:");
    } else {
      expect(result.value.flags.hasS3).toBe(true);
      expect(result.value.DATABASE_URL).toContain("flowaid_app:");
    }
  });

  it("gives web and worker-code no secret", () => {
    const secret = /MASTER_KEY|_API_KEY$|S3_SECRET_KEY|ADMIN_PASSWORD|CLIENT_SECRET|JWT_PRIVATE/;
    for (const name of ["web", "worker-code"]) {
      const svc = project.services[name];
      expect(svc?.env_file, `${name} env_file`).toBeUndefined();
      const names = Object.keys(environmentOf(svc ?? {}));
      expect(
        names.filter((key) => secret.test(key)),
        name,
      ).toEqual([]);
      const values = Object.values(environmentOf(svc ?? {}));
      for (const value of Object.values(REQUIRED)) {
        if (value !== REQUIRED.POSTGRES_CODE_PASSWORD || name === "web") {
          expect(values.join("\n"), `${name} holds ${value}`).not.toContain(value);
        }
      }
    }
  });

  it("keeps .git, node_modules and every .env* except .env.example out of the build context", () => {
    const out = join(workDir, "context");
    // A stdin Dockerfile that copies the whole context out again; .dockerignore applies to it
    // exactly as it applies to docker/Dockerfile because both use the repository root.
    const result = docker(
      ["build", "--quiet", "-f", "-", "--output", `type=local,dest=${out}`, "."],
      { input: "FROM scratch\nCOPY . /context\n" },
    );
    expect(result.ok, result.stderr).toBe(true);
    const context = join(out, "context");
    const top = readdirSync(context);
    expect(top).toContain("package.json");
    expect(top).toContain("pnpm-lock.yaml");
    expect(top).toContain(".env.example");
    expect(top).toContain(".dockerignore");
    expect(top.filter((entry) => entry.startsWith(".env") && entry !== ".env.example")).toEqual([]);
    expect(top).not.toContain(".git");
    expect(top).not.toContain("node_modules");
    expect(top).not.toContain("docs");
    expect(top).not.toContain(".flowaid");
    expect(top).not.toContain(".claude");
    for (const dir of ["packages", "apps"]) {
      const base = join(context, dir);
      if (!existsSync(base)) {
        continue;
      }
      for (const pkg of readdirSync(base)) {
        for (const forbidden of ["node_modules", "dist", ".turbo", "coverage"]) {
          expect(existsSync(join(base, pkg, forbidden)), `${dir}/${pkg}/${forbidden}`).toBe(false);
        }
      }
    }
  });
});
