import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ResizablePanels } from "./resizable-panels.js";

describe("ResizablePanels", () => {
  beforeEach(() => localStorage.clear());

  it("resizes from the keyboard and persists the preference", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ResizablePanels
        primary={<p>Editor</p>}
        secondary={<p>Preview</p>}
        primaryLabel="Markdown editor"
        secondaryLabel="Report preview"
        resizeLabel="Resize editor and preview"
        storageKey="test-split"
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize editor and preview",
    });

    separator.focus();
    await user.keyboard("{ArrowRight}");

    expect(separator.getAttribute("aria-valuenow")).toBe("53");
    expect(Number(localStorage.getItem("test-split"))).toBeCloseTo(0.525);

    unmount();
    render(
      <ResizablePanels
        primary={<p>Editor</p>}
        secondary={<p>Preview</p>}
        primaryLabel="Markdown editor"
        secondaryLabel="Report preview"
        resizeLabel="Resize editor and preview"
        storageKey="test-split"
      />,
    );

    expect(
      screen
        .getByRole("separator", { name: "Resize editor and preview" })
        .getAttribute("aria-valuenow"),
    ).toBe("53");
  });

  it("supports Home, End, and double-click reset", async () => {
    const user = userEvent.setup();
    render(
      <ResizablePanels
        primary={<p>Editor</p>}
        secondary={<p>Preview</p>}
        primaryLabel="Markdown editor"
        secondaryLabel="Report preview"
        resizeLabel="Resize editor and preview"
        storageKey="test-split"
        initialPrimarySize={0.6}
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize editor and preview",
    });

    separator.focus();
    await user.keyboard("{Home}");
    expect(separator.getAttribute("aria-valuenow")).toBe("10");

    await user.keyboard("{End}");
    expect(separator.getAttribute("aria-valuenow")).toBe("90");

    await user.dblClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("60");
  });
});
