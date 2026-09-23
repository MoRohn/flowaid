/**
 * Users, refresh-token sessions and single-use user tokens.
 *
 * Refresh tokens rotate: `rotateRefreshToken` exchanges a live token for its successor in one
 * statement. Presenting a token that was already rotated is reuse (a stolen token) and revokes
 * the whole family (every token of that login), per OAuth 2.0 Security BCP §4.14.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { Tx } from "../db.js";
import { refreshTokens, users, userTokens } from "../schema.js";

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export async function createUser(
  tx: Tx,
  input: { email: string; name: string; passwordHash?: string | null; status?: UserRow["status"] },
): Promise<UserRow> {
  const [row] = await tx
    .insert(users)
    .values({
      id: uuidv7(),
      email: input.email.trim(),
      name: input.name,
      passwordHash: input.passwordHash ?? null,
      status: input.status ?? "invited",
    })
    .returning();
  return row as UserRow;
}

/** Case-insensitive, matching the `lower(email)` unique index. */
export async function findUserByEmail(tx: Tx, email: string): Promise<UserRow | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email.trim()})`);
  return row ?? null;
}

export async function getUser(tx: Tx, id: string): Promise<UserRow | null> {
  const [row] = await tx.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

/** Invalidates every access token of a user (JWT claim `tv`). */
export async function bumpTokenVersion(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ v: users.tokenVersion });
  return row?.v ?? 0;
}

export async function recordLogin(tx: Tx, userId: string): Promise<void> {
  await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export async function issueRefreshToken(
  tx: Tx,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    familyId?: string;
    userAgent?: string | null;
    ip?: string | null;
  },
): Promise<RefreshTokenRow> {
  const [row] = await tx
    .insert(refreshTokens)
    .values({
      id: uuidv7(),
      userId: input.userId,
      familyId: input.familyId ?? uuidv7(),
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    })
    .returning();
  return row as RefreshTokenRow;
}

export type RotateResult =
  | { status: "rotated"; token: RefreshTokenRow; userId: string }
  | { status: "reused"; userId: string; familyId: string }
  | { status: "invalid" };

export async function rotateRefreshToken(
  tx: Tx,
  presentedHash: string,
  next: { tokenHash: string; expiresAt: Date; userAgent?: string | null; ip?: string | null },
): Promise<RotateResult> {
  const [current] = await tx
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, presentedHash))
    .for("update");
  if (!current) return { status: "invalid" };
  if (current.revokedAt !== null || current.replacedById !== null) {
    if (current.replacedById !== null) {
      await revokeFamily(tx, current.familyId);
      return { status: "reused", userId: current.userId, familyId: current.familyId };
    }
    return { status: "invalid" };
  }
  if (current.expiresAt.getTime() <= Date.now()) return { status: "invalid" };
  const token = await issueRefreshToken(tx, {
    ...next,
    userId: current.userId,
    familyId: current.familyId,
  });
  await tx
    .update(refreshTokens)
    .set({ replacedById: token.id, revokedAt: new Date() })
    .where(eq(refreshTokens.id, current.id));
  return { status: "rotated", token, userId: current.userId };
}

export async function revokeFamily(tx: Tx, familyId: string): Promise<number> {
  const rows = await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return rows.length;
}

/** Logout everywhere: revokes every live refresh token and bumps the token version. */
export async function revokeAllSessions(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await bumpTokenVersion(tx, userId);
}

export async function createUserToken(
  tx: Tx,
  input: {
    userId: string;
    kind: (typeof userTokens.$inferSelect)["kind"];
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.insert(userTokens).values({ id: uuidv7(), ...input });
}

/** Consumes a single-use token (invite, password reset, email verification) atomically. */
export async function consumeUserToken(
  tx: Tx,
  kind: (typeof userTokens.$inferSelect)["kind"],
  tokenHash: string,
): Promise<{ userId: string } | null> {
  const [row] = await tx
    .update(userTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userTokens.tokenHash, tokenHash),
        eq(userTokens.kind, kind),
        isNull(userTokens.usedAt),
        gt(userTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: userTokens.userId });
  return row ?? null;
}
