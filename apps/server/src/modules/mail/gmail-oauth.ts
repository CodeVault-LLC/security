import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "ascii").digest(),
  );
  return { verifier, challenge };
}

export function gmailScopes(enableReplyTracking: boolean): string[] {
  return [
    ...GOOGLE_IDENTITY_SCOPES,
    GMAIL_SEND_SCOPE,
    ...(enableReplyTracking ? [GMAIL_READONLY_SCOPE] : []),
  ];
}

export function buildGmailAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes: readonly string[];
  loginHint?: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  if (input.loginHint !== undefined)
    url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}
