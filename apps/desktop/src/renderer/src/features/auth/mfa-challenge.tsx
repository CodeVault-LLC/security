import { useState } from "react";
import { Button } from "@codevault/ui";

import { TotpInput } from "./totp-input.js";

export function MfaChallenge(props: {
  email: string;
  busy: boolean;
  error: string | null;
  onSubmit(totp: string): Promise<void>;
  onBack(): void;
}): React.JSX.Element {
  const [totp, setTotp] = useState("");
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSubmit(totp);
        }}
        className="w-[380px] rounded-(--cv-radius-lg) border border-border bg-surface p-5"
      >
        <h1 className="text-[15px] font-semibold">
          Authenticator verification
        </h1>
        <p className="mt-1 text-[12px] text-text-muted">
          Enter the current six-digit code for {props.email}. A code can be
          accepted only once.
        </p>
        <TotpInput
          id="totp"
          label="Authentication code"
          value={totp}
          onChange={setTotp}
          autoFocus
          disabled={props.busy}
          className="mt-4"
        />
        {props.error === null ? null : (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {props.error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-4 w-full"
          disabled={props.busy || totp.length !== 6}
        >
          {props.busy ? "Verifying…" : "Sign in securely"}
        </Button>
        <button
          type="button"
          className="mt-3 w-full text-[12px] text-text-muted hover:text-text"
          onClick={props.onBack}
        >
          Back to credentials
        </button>
      </form>
    </div>
  );
}
