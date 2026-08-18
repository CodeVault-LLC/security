import { useRef } from "react";

import { Input, Label, cn } from "@codevault/ui";

const TOTP_LENGTH = 6;

export function TotpInput({
  id,
  label,
  value,
  onChange,
  autoFocus = false,
  disabled = false,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from(
    { length: TOTP_LENGTH },
    (_, index) => value[index] ?? "",
  );

  const focusSlot = (index: number): void => {
    inputRefs.current[Math.max(0, Math.min(index, TOTP_LENGTH - 1))]?.focus();
  };

  const updateDigit = (index: number, digit: string): void => {
    const next = [...digits];
    next[index] = digit;
    onChange(next.join("").slice(0, TOTP_LENGTH));
    if (digit !== "") focusSlot(index + 1);
  };

  const distributeDigits = (index: number, input: string): void => {
    const incoming = input.replace(/\D/gu, "").slice(0, TOTP_LENGTH - index);
    if (incoming === "") return;
    const next = [...digits];
    for (const [offset, digit] of [...incoming].entries()) {
      next[index + offset] = digit;
    }
    onChange(next.join("").slice(0, TOTP_LENGTH));
    focusSlot(index + incoming.length);
  };

  return (
    <div className={className}>
      <Label id={`${id}-label`}>{label}</Label>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="mt-1.5 flex gap-2"
      >
        {digits.map((digit, index) => (
          <Input
            key={index}
            ref={(node) => {
              inputRefs.current[index] = node;
            }}
            id={`${id}-${index + 1}`}
            aria-label={`${label} digit ${index + 1} of ${TOTP_LENGTH}`}
            value={digit}
            onChange={(event) => {
              const numeric = event.target.value.replace(/\D/gu, "");
              if (numeric.length > 1) {
                distributeDigits(index, numeric);
              } else {
                updateDigit(index, numeric);
              }
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && digit === "" && index > 0) {
                event.preventDefault();
                const next = [...digits];
                next[index - 1] = "";
                onChange(next.join("").slice(0, TOTP_LENGTH));
                focusSlot(index - 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusSlot(index - 1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                focusSlot(index + 1);
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData
                .getData("text")
                .replace(/\D/gu, "");
              if (pasted === "") return;
              event.preventDefault();
              distributeDigits(index, pasted);
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            className={cn(
              "h-11 w-11 px-0 text-center font-mono text-[18px] font-semibold tabular-nums",
              "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent/25",
            )}
          />
        ))}
      </div>
    </div>
  );
}
