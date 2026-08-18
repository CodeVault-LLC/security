import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MfaChallenge } from "./mfa-challenge.js";

describe("MfaChallenge", () => {
  it("collects and submits a six-digit code through separate slots", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <MfaChallenge
        email="researcher@example.com"
        busy={false}
        error={null}
        onSubmit={onSubmit}
        onBack={() => undefined}
      />,
    );

    const slots = screen.getAllByLabelText(
      /Authentication code digit \d of 6/iu,
    );
    expect(slots).toHaveLength(6);

    await user.type(slots[0]!, "123456");
    expect(slots.map((slot) => (slot as HTMLInputElement).value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);

    await user.click(screen.getByRole("button", { name: "Sign in securely" }));
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("distributes a pasted authenticator code across all six slots", async () => {
    const user = userEvent.setup();
    render(
      <MfaChallenge
        email="researcher@example.com"
        busy={false}
        error={null}
        onSubmit={async () => undefined}
        onBack={() => undefined}
      />,
    );

    const slots = screen.getAllByLabelText(
      /Authentication code digit \d of 6/iu,
    );
    await user.click(slots[0]!);
    await user.paste("654321");

    expect(slots.map((slot) => (slot as HTMLInputElement).value)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
      "1",
    ]);
  });

  it("distributes a browser-autofilled code across all six slots", () => {
    render(
      <MfaChallenge
        email="researcher@example.com"
        busy={false}
        error={null}
        onSubmit={async () => undefined}
        onBack={() => undefined}
      />,
    );

    const slots = screen.getAllByLabelText(
      /Authentication code digit \d of 6/iu,
    );
    fireEvent.change(slots[0]!, { target: { value: "123456" } });

    expect(slots.map((slot) => (slot as HTMLInputElement).value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });
});
