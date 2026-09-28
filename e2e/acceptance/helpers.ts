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

const WORKSPACE_HOME = /\/[a-z0-9-]+\/workflows$/;

/**
 * Opens the app as the owner and returns the workspace slug it lands on. In local mode (the stack
 * on this computer) the app signs in by itself; in password mode it fills the sign-in form.
 */
export async function signIn(page: Page): Promise<string> {
  await page.goto("/login");
  const form = page.getByRole("button", { name: "Sign in" });
  await Promise.race([form.waitFor(), page.waitForURL(WORKSPACE_HOME)]);
  if (!WORKSPACE_HOME.test(page.url())) {
    const { email, password } = credentials();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await form.click();
  }
  await expect(page).toHaveURL(WORKSPACE_HOME);
  return new URL(page.url()).pathname.split("/")[1] as string;
}

/** Headers for API calls made with the page's session. */
export const apiHeaders = (ws: string) => ({ "x-workspace": ws, "x-requested-with": "flowaid" });
