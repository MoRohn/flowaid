/**
 * Session access tokens: ES256 JWTs (15 min) with claims `sub`, `sid`, `tv` only (API.md §1).
 * Keys come from `FLOWAID_JWT_PRIVATE_KEY`/`_PUBLIC_KEY` (PEM), from `FLOWAID_JWT_KEYS_DIR`
 * (generated there on first boot), or — outside production — an in-memory pair.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SignJWT,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type CryptoKey,
  type JWK,
} from "jose";
import { UnauthorizedError } from "@flowaid/workflow-core";

export const ACCESS_TTL_S = 15 * 60;
const ISSUER = "flowaid";

export interface AccessClaims {
  sub: string;
  sid: string;
  tv: number;
}

export class JwtKeys {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    readonly kid: string,
    private readonly jwk: JWK,
  ) {}

  static async fromPem(privatePem: string, publicPem: string): Promise<JwtKeys> {
    const privateKey = await importPKCS8(privatePem, "ES256", { extractable: true });
    const publicKey = await importSPKI(publicPem, "ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    const kid = createHash("sha256").update(publicPem.trim()).digest("base64url").slice(0, 16);
    return new JwtKeys(privateKey, publicKey, kid, { ...jwk, kid, alg: "ES256", use: "sig" });
  }

  static async generate(): Promise<{ keys: JwtKeys; privatePem: string; publicPem: string }> {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const privatePem = await exportPKCS8(pair.privateKey);
    const publicPem = await exportSPKI(pair.publicKey);
    return { keys: await JwtKeys.fromPem(privatePem, publicPem), privatePem, publicPem };
  }

  /** PEM env vars, else a key directory (created on first boot), else an ephemeral pair. */
  static async load(o: {
    privatePem?: string;
    publicPem?: string;
    dir?: string;
    production: boolean;
  }): Promise<JwtKeys> {
    if (o.privatePem && o.publicPem) return JwtKeys.fromPem(o.privatePem, o.publicPem);
    if (o.dir) {
      const priv = join(o.dir, "jwt-private.pem");
      const pub = join(o.dir, "jwt-public.pem");
      if (existsSync(priv) && existsSync(pub))
        return JwtKeys.fromPem(readFileSync(priv, "utf8"), readFileSync(pub, "utf8"));
      const g = await JwtKeys.generate();
      mkdirSync(o.dir, { recursive: true, mode: 0o700 });
      writeFileSync(priv, g.privatePem, { mode: 0o600 });
      writeFileSync(pub, g.publicPem, { mode: 0o644 });
      return g.keys;
    }
    if (o.production)
      throw new Error(
        "production needs FLOWAID_JWT_PRIVATE_KEY/FLOWAID_JWT_PUBLIC_KEY or FLOWAID_JWT_KEYS_DIR",
      );
    return (await JwtKeys.generate()).keys;
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.jwk] };
  }

  sign(claims: AccessClaims, now = Date.now()): Promise<string> {
    return new SignJWT({ sid: claims.sid, tv: claims.tv })
      .setProtectedHeader({ alg: "ES256", kid: this.kid, typ: "JWT" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + ACCESS_TTL_S)
      .sign(this.privateKey);
  }

  async verify(token: string, now = Date.now()): Promise<AccessClaims & { exp: number }> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: ISSUER,
        algorithms: ["ES256"],
        currentDate: new Date(now),
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.sid !== "string" ||
        typeof payload.tv !== "number" ||
        typeof payload.exp !== "number"
      )
        throw new UnauthorizedError("malformed session token");
      return { sub: payload.sub, sid: payload.sid, tv: payload.tv, exp: payload.exp };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError("invalid or expired session");
    }
  }
}
