import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button, Input, Label } from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { useSession } from "../../lib/session.js";

/**
 * Sign-in.
 *
 * There is no "create an account" link, and there never will be: accounts exist
 * only because an administrator issued an invitation. The screen says so
 * plainly rather than leaving a researcher hunting for a signup form.
 */

const DEFAULT_SERVER_KEY = "codevault.serverUrl";

export function LoginScreen(): React.JSX.Element {
  const signIn = useSession((state) => state.signIn);
  const [serverUrl, setServerUrl] = useState(
    () =>
      window.localStorage.getItem(DEFAULT_SERVER_KEY) ??
      "https://codevault.internal",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const outcome = await bridge().auth.login(
        serverUrl.trim().replace(/\/+$/, ""),
        email.trim(),
        password,
      );

      if (!outcome.ok) {
        setError(outcome.message);

        return;
      }

      window.localStorage.setItem(DEFAULT_SERVER_KEY, serverUrl.trim());
      signIn(outcome.data.user, outcome.data.storageWarning);
    } catch {
      setError("The CodeVault server could not be reached.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-[380px] rounded-(--cv-radius-lg) border border-border bg-surface p-5"
      >
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck aria-hidden className="size-5 text-accent" />
          <div>
            <h1 className="text-[15px] font-semibold leading-tight">
              CodeVault
            </h1>
            <p className="text-[11px] text-text-muted">
              Security research and coordinated disclosure
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="server">Server</Label>
            <Input
              id="server"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://codevault.internal"
              autoComplete="url"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1"
            />
          </div>
        </div>

        {error === null ? null : (
          <p
            role="alert"
            className="mt-3 rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-4 w-full"
          disabled={busy || email.length === 0 || password.length === 0}
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-text-muted">
          CodeVault has no public registration. Accounts are created from an
          administrator's invitation, and the first administrator is created on
          the server with{" "}
          <code className="font-mono text-[10.5px]">admin:create</code>.
        </p>
      </form>
    </div>
  );
}
