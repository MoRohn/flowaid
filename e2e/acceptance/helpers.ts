/**
 * Shared steps for the acceptance specs: the owner's credentials, signing in, and the headers a
 * session needs to call the API directly (workspace and the CSRF marker).
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page } from "@playwright/test";

export function credentials(): { email: string; password: string } {
  const file = ".flowaid/dev.env";
  const local = existsSync(file)
    ? (parseEnv(readFileSync(file, "utf8")) as Record<string, string>)
    : {};
  return {
    email: process.env["E2E_EMAIL"] ?? local.FLOWAID_ADMIN_EMAIL ?? "owner@flowaid.local",
    password: process.env["E2E_PASSWORD"] ?? local.FLOWAID_ADMIN_PASSWORD ?? "",
  };
}

/** Signs in as the owner and returns the workspace slug the app lands on. */
export async function signIn(page: Page): Promise<string> {
  const { email, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/workflows$/);
  return new URL(page.url()).pathname.split("/")[1] as string;
}

/** Headers for API calls made with the page's session. */
export const apiHeaders = (ws: string) => ({ "x-workspace": ws, "x-requested-with": "flowaid" });
