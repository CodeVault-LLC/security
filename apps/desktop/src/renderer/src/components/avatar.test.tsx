import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./avatar.js";

const avatarBridge = vi.hoisted(() => ({
  load: vi.fn(),
  loadUser: vi.fn(),
}));

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({ avatars: avatarBridge }),
}));

describe("Avatar", () => {
  beforeEach(() => {
    avatarBridge.load.mockReset();
    avatarBridge.loadUser.mockReset();
    vi.stubGlobal(
      "Image",
      class LoadedImage extends EventTarget {
        complete = true;
        naturalWidth = 64;
        referrerPolicy = "";
        crossOrigin: string | null = null;
        src = "";
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders a deterministic icon instead of initials when no image exists", () => {
    const { unmount } = render(
      <Avatar avatarId={null} label="Ada Lovelace" seed="user-ada" />,
    );

    const first = screen.getByRole("img", { name: "Ada Lovelace" });
    const firstFallback = first.querySelector<HTMLImageElement>(
      "img[data-avatar-fallback]",
    );

    expect(firstFallback?.src).toMatch(/^data:image\/svg\+xml/);
    expect(screen.queryByText("AD")).toBeNull();

    const firstSource = firstFallback?.src;
    unmount();

    render(<Avatar avatarId={null} label="Ada Lovelace" seed="user-ada" />);
    expect(
      screen
        .getByRole("img", { name: "Ada Lovelace" })
        .querySelector<HTMLImageElement>("img[data-avatar-fallback]")?.src,
    ).toBe(firstSource);
  });

  it("loads the current uploaded avatar from a stable user id", async () => {
    avatarBridge.loadUser.mockResolvedValue({
      ok: true,
      data: "data:image/webp;base64,dXNlci1hdmF0YXI=",
    });

    render(
      <Avatar
        avatarId={null}
        userId="018f03d2-b7fd-7aef-8ac4-24b921aa6723"
        label="Ada Lovelace"
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("img", { name: "Ada Lovelace" })
          .querySelector<HTMLImageElement>("img:not([data-avatar-fallback])")
          ?.src,
      ).toBe("data:image/webp;base64,dXNlci1hdmF0YXI=");
    });
  });

  it("can render the avatar and full identity label as one inline unit", () => {
    render(
      <Avatar
        avatarId={null}
        label="Ada Lovelace"
        seed="user-ada"
        size="sm"
        showLabel
      />,
    );

    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "Ada Lovelace" })).toBeNull();
  });

  it("accepts a pre-authorized image while retaining the generated fallback", () => {
    render(
      <Avatar
        avatarId={null}
        label="CodeVault Research"
        seed="organization-id"
        source="data:image/webp;base64,b3JnLWF2YXRhcg=="
      />,
    );

    expect(
      screen
        .getByRole("img", { name: "CodeVault Research" })
        .querySelector<HTMLImageElement>("img:not([data-avatar-fallback])")
        ?.src,
    ).toBe("data:image/webp;base64,b3JnLWF2YXRhcg==");
  });
});
