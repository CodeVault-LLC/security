import { useState } from "react";
import { Button, Input, Label } from "@codevault/ui";

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
        <div className="mt-4">
          <Label htmlFor="totp">Authentication code</Label>
          <Input
            id="totp"
            value={totp}
            onChange={(event) =>
              setTotp(event.target.value.replace(/\D/gu, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            className="mt-1 font-mono tracking-[0.3em]"
            autoFocus
          />
        </div>
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
