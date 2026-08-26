import { useState } from "react";

import { Button, Label } from "@codevault/ui";

import type { EnrollmentSetup } from "../../../../preload/contracts.js";
import { bridge } from "../../lib/bridge.js";
import { TotpInput } from "./totp-input.js";

export function MigratedEnrollment({
  setup,
  onDone,
}: {
  setup: EnrollmentSetup;
  onDone: () => void;
}): React.JSX.Element {
  const [totp, setTotp] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (codes !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-[430px] rounded-(--cv-radius-lg) border border-border bg-surface p-5">
          <h1 className="text-[15px] font-semibold">
            Save your recovery codes
          </h1>
          <p className="mt-2 text-[12px] text-text-muted">
            Store these one-time codes in your password manager. They will not
            be shown again.
          </p>
          <pre className="mt-3 grid grid-cols-2 gap-1 rounded-(--cv-radius) bg-background p-3 text-[11px]">
            {codes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </pre>
          <Button className="mt-4 w-full" onClick={onDone}>
            I saved them — return to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        className="w-[430px] rounded-(--cv-radius-lg) border border-border bg-surface p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void bridge()
            .auth.enrollmentConfirm(totp)
            .then((outcome) => {
              if (outcome.ok) setCodes(outcome.data.recoveryCodes);
              else setError(outcome.message);
            })
            .catch(() => setError("The enrollment could not be completed."))
            .finally(() => setBusy(false));
        }}
      >
        <h1 className="text-[15px] font-semibold">Protect your account</h1>
        <p className="mt-2 text-[12px] text-text-muted">
          Your organization requires multi-factor authentication. Add the secret
          below to your authenticator, then enter its six-digit code.
        </p>
        <Label htmlFor="migration-secret" className="mt-4 block">
          Authenticator secret
        </Label>
        <code
          id="migration-secret"
          className="mt-1 block select-all rounded-(--cv-radius) bg-background p-2 text-[12px]"
        >
          {setup.manualSecret}
        </code>
        <TotpInput
          id="migration-totp"
          label="Authenticator code"
          value={totp}
          onChange={setTotp}
          disabled={busy}
          className="mt-4"
        />
        {error === null ? null : (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="mt-4 w-full"
          disabled={busy || totp.length !== 6}
        >
          {busy ? "Verifying…" : "Finish MFA enrollment"}
        </Button>
      </form>
    </div>
  );
}
