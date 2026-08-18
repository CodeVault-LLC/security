import { useState } from "react";
import { Check } from "lucide-react";

import type { InviteInspection } from "@codevault/contracts";
import { Button, Input, Label } from "@codevault/ui";

import type { EnrollmentSetup } from "../../../../preload/contracts.js";
import { bridge } from "../../lib/bridge.js";
import { AuthHeader } from "./auth-header.js";
import { TotpInput } from "./totp-input.js";

const PHASES = ["TOKEN", "PROFILE", "TOTP", "RECOVERY"] as const;

export function InviteOnboarding(props: {
  serverUrl: string;
  onBack(): void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<"TOKEN" | "PROFILE" | "TOTP" | "RECOVERY">(
    "TOKEN",
  );
  const [token, setToken] = useState("");
  const [inspection, setInspection] = useState<InviteInspection | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setup, setSetup] = useState<EnrollmentSetup | null>(null);
  const [totp, setTotp] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phaseIndex = PHASES.indexOf(phase);

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError("The enrollment request could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-[460px] rounded-(--cv-radius-lg) border border-border bg-surface p-5">
        <AuthHeader />
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-4 flex items-center gap-1.5" aria-hidden>
            {PHASES.map((step, index) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full ${index <= phaseIndex ? "bg-accent" : "bg-surface-muted"}`}
              />
            ))}
          </div>
          <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-accent">
            Invitation setup · Step {phaseIndex + 1} of {PHASES.length}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold">
            {phase === "TOKEN" ? "Join your organization" : null}
            {phase === "PROFILE" ? "Create your profile" : null}
            {phase === "TOTP" ? "Protect your account" : null}
            {phase === "RECOVERY" ? "Save recovery codes" : null}
          </h2>
        </div>
        {phase === "TOKEN" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const outcome = await bridge().invitation.inspect(
                  props.serverUrl,
                  token.trim(),
                );
                if (!outcome.ok) {
                  setError(outcome.message);
                  return;
                }
                setInspection(outcome.data);
                setToken("");
                setPhase("PROFILE");
              });
            }}
          >
            <p className="mt-1 text-[12px] text-text-muted">
              Paste the one-time invitation supplied by an administrator.
            </p>
            <div className="mt-4">
              <Label htmlFor="invite-token">Invitation token</Label>
              <Input
                id="invite-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="mt-1 font-mono"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              className="mt-4 w-full"
              disabled={busy || token.length < 32}
            >
              Continue
            </Button>
          </form>
        ) : null}
        {phase === "PROFILE" && inspection ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (password !== confirmation) {
                  setError("The password confirmation does not match.");
                  return;
                }
                const outcome = await bridge().invitation.start(
                  displayName,
                  password,
                );
                if (!outcome.ok) {
                  setError(outcome.message);
                  return;
                }
                setPassword("");
                setConfirmation("");
                setSetup(outcome.data);
                setPhase("TOTP");
              });
            }}
          >
            <div className="mt-3 flex items-start gap-2.5 rounded-(--cv-radius) border border-border bg-surface-muted p-3 text-[12px]">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                <Check aria-hidden className="size-3" />
              </span>
              <div>
                <strong className="text-text">
                  {inspection.organizationName}
                </strong>
                <p className="mt-0.5 text-text-muted">
                  {inspection.email} · {inspection.role}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-1"
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              className="mt-4 w-full"
              disabled={busy || displayName.length < 2 || password.length < 12}
            >
              Set up authenticator
            </Button>
          </form>
        ) : null}
        {phase === "TOTP" && setup ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const outcome = await bridge().invitation.confirm(totp);
                if (!outcome.ok) {
                  setError(outcome.message);
                  return;
                }
                setSetup(null);
                setTotp("");
                setRecoveryCodes(outcome.data.recoveryCodes);
                setPhase("RECOVERY");
              });
            }}
          >
            <p className="mt-2 text-[12px] text-text-muted">
              Add this account to a trusted authenticator app, then enter its
              current code.
            </p>
            <div className="mt-3 rounded border border-border bg-background p-3">
              <p className="text-[10px] uppercase text-text-muted">
                Manual setup key
              </p>
              <code className="mt-1 block break-all font-mono text-[13px]">
                {setup.manualSecret}
              </code>
            </div>
            <TotpInput
              id="enroll-totp"
              label="Six-digit code"
              value={totp}
              onChange={setTotp}
              disabled={busy}
              className="mt-3"
            />
            <Button
              type="submit"
              variant="primary"
              className="mt-4 w-full"
              disabled={busy || totp.length !== 6}
            >
              Finish secure enrollment
            </Button>
          </form>
        ) : null}
        {phase === "RECOVERY" ? (
          <div>
            <p className="mt-2 text-[12px] text-text-muted">
              Save these recovery codes offline now. They are shown once and
              each can be used only once.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-warning/50 bg-warning/5 p-3">
              {recoveryCodes.map((code) => (
                <code className="text-[11px]" key={code}>
                  {code}
                </code>
              ))}
            </div>
            <Button
              variant="primary"
              className="mt-4 w-full"
              onClick={props.onBack}
            >
              I saved the codes — return to sign in
            </Button>
          </div>
        ) : null}
        {error === null ? null : (
          <p
            role="alert"
            className="mt-3 rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger"
          >
            {error}
          </p>
        )}
        {phase === "TOKEN" ? (
          <button
            type="button"
            className="mt-3 w-full text-[12px] text-text-muted hover:text-text"
            onClick={props.onBack}
          >
            Back to sign in
          </button>
        ) : null}
      </div>
    </div>
  );
}
