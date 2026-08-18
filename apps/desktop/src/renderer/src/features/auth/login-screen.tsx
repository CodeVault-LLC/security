import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button, Input, Label } from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { useSession } from "../../lib/session.js";
import { InviteOnboarding } from "./invite-onboarding.js";
import { MigratedEnrollment } from "./migrated-enrollment.js";
import { MfaChallenge } from "./mfa-challenge.js";
import type { EnrollmentSetup } from "../../../../preload/contracts.js";

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
  const [mode, setMode] = useState<
    "LOGIN" | "MFA" | "INVITATION" | "ENROLLMENT"
  >("LOGIN");
  const [enrollment, setEnrollment] = useState<EnrollmentSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalizedServer = serverUrl.trim().replace(/\/+$/, "");

  if (mode === "INVITATION") {
    return (
      <InviteOnboarding
        serverUrl={normalizedServer}
        onBack={() => setMode("LOGIN")}
      />
    );
  }
  if (mode === "MFA") {
    return (
      <MfaChallenge
        email={email}
        busy={busy}
        error={error}
        onBack={() => {
          setError(null);
          setMode("LOGIN");
        }}
        onSubmit={async (totp) => {
          setBusy(true);
          setError(null);
          try {
            const outcome = await bridge().auth.loginComplete(totp);
            if (!outcome.ok) {
              setError(outcome.message);
              return;
            }
            window.localStorage.setItem(DEFAULT_SERVER_KEY, normalizedServer);
            signIn(outcome.data.user, outcome.data.storageWarning);
          } catch {
            setError("The CodeVault server could not be reached.");
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }
  if (mode === "ENROLLMENT" && enrollment !== null) {
    return (
      <MigratedEnrollment
        setup={enrollment}
        onDone={() => {
          setEnrollment(null);
          setMode("LOGIN");
        }}
      />
    );
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const outcome = await bridge().auth.loginStart(
        normalizedServer,
        email.trim(),
        password,
      );
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      if (outcome.data.challenge === "ENROLLMENT_REQUIRED") {
        const setup = await bridge().auth.enrollmentStart();
        if (!setup.ok) {
          setError(setup.message);
          return;
        }
        setPassword("");
        setEnrollment(setup.data);
        setMode("ENROLLMENT");
        return;
      }
      setPassword("");
      setMode("MFA");
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
              Protected organization access
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
              autoComplete="url"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="email">Organization email</Label>
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
          {busy ? "Checking credentials…" : "Continue"}
        </Button>
        <button
          type="button"
          className="mt-3 w-full text-[12px] text-accent hover:underline"
          onClick={() => setMode("INVITATION")}
        >
          I have an organization invitation
        </button>
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-text-muted">
          Every account is invitation-only and protected by an authenticator.
          There is no public registration.
        </p>
      </form>
    </div>
  );
}
