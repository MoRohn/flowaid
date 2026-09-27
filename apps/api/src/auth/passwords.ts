/** argon2id password hashing; unknown users are checked against a fixed dummy hash (constant time). */
import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
let dummy: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    dummy ??= argon2.hash("flowaid-dummy-password", OPTIONS);
    await argon2.verify(await dummy, password).catch(() => false);
    return false;
  }
  return argon2.verify(hash, password).catch(() => false);
}

/** Minimum password policy: 12+ characters, not all one class. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "must be at least 12 characters";
  if (password.length > 256) return "must be at most 256 characters";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) return "must mix at least two of lower case, upper case, digits and symbols";
  return null;
}
