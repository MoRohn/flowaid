/**
 * Why a sign-in that the server accepted did not stick. Session cookies are `Secure` in
 * production, and browsers keep a Secure cookie over plain http only on this computer
 * (localhost, 127.0.0.1, *.localhost). Opened as http://flowaid.lan:3000 the cookie is dropped and every
 * page sends the person back to sign in; this names the cause and the two ways out.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\./.test(h);
}

export function sessionNotKeptMessage(location: { protocol: string; hostname: string }): string {
  if (location.protocol === "http:" && !isLoopbackHost(location.hostname))
    return (
      `Signed in, but this browser will not keep the session over plain http://${location.hostname}. ` +
      "Open FlowAId over https (a TLS proxy in front of it), or, on a private network, set " +
      "FLOWAID_ALLOW_INSECURE_HTTP=true and FLOWAID_WEB_URL / FLOWAID_BASE_URL to this address in .env, " +
      "then restart (docker compose up -d)."
    );
  return "Signed in, but this browser did not keep the session. Allow cookies for this site and try again.";
}
