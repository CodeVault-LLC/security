import { describe, expect, it } from "vitest";

import { UploadSelectionStore } from "./upload-selections.js";

const selection = {
  path: "/private/evidence.bin",
  filename: "evidence.bin",
  sizeBytes: 8,
  mimeType: "application/octet-stream",
  sha256: "a".repeat(64),
};
const firstOwner = {
  userId: "user-a",
  serverUrl: "https://a.example",
  token: "session-a",
};
const secondOwner = {
  userId: "user-b",
  serverUrl: "https://b.example",
  token: "session-b",
};

describe("upload selection capabilities", () => {
  it("binds a selection to one user and server", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);
    expect(() =>
      store.consume([issued.selectionId], secondOwner, 1_001),
    ).toThrow(/expired or changed session/u);
    expect(store.consume([issued.selectionId], firstOwner, 1_001)).toEqual([
      issued,
    ]);
  });

  it("does not survive a new session for the same account", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);
    expect(() =>
      store.consume(
        [issued.selectionId],
        { ...firstOwner, token: "replacement-session" },
        1_001,
      ),
    ).toThrow(/expired or changed session/u);
  });

  it("expires and consumes each capability once", () => {
    const store = new UploadSelectionStore(100);
    const issued = store.issue(selection, firstOwner, 1_000);
    expect(() =>
      store.consume([issued.selectionId], firstOwner, 1_100),
    ).toThrow(/expired/u);

    const replacement = store.issue(selection, firstOwner, 2_000);
    expect(store.consume([replacement.selectionId], firstOwner, 2_001)).toEqual(
      [replacement],
    );
    expect(() =>
      store.consume([replacement.selectionId], firstOwner, 2_002),
    ).toThrow(/expired/u);
  });

  it("keeps a capability available until an upload succeeds", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);

    expect(store.resolve([issued.selectionId], firstOwner, 1_001)).toEqual([
      issued,
    ]);
    expect(store.resolve([issued.selectionId], firstOwner, 1_002)).toEqual([
      issued,
    ]);
    expect(store.consume([issued.selectionId], firstOwner, 1_003)).toEqual([
      issued,
    ]);
    expect(() =>
      store.resolve([issued.selectionId], firstOwner, 1_004),
    ).toThrow(/expired/u);
  });

  it("checks availability without consuming the capability", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);

    expect(store.areAvailable([issued.selectionId], firstOwner, 1_001)).toBe(
      true,
    );
    expect(store.areAvailable([issued.selectionId], secondOwner, 1_001)).toBe(
      false,
    );
    expect(store.consume([issued.selectionId], firstOwner, 1_002)).toEqual([
      issued,
    ]);
    expect(store.areAvailable([issued.selectionId], firstOwner, 1_003)).toBe(
      false,
    );
  });

  it("rejects duplicate identifiers without consuming the capability", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);
    expect(() =>
      store.consume(
        [issued.selectionId, issued.selectionId],
        firstOwner,
        1_001,
      ),
    ).toThrow(/more than once/u);
    expect(store.consume([issued.selectionId], firstOwner, 1_001)).toEqual([
      issued,
    ]);
  });

  it("revokes every outstanding capability on clear", () => {
    const store = new UploadSelectionStore();
    const issued = store.issue(selection, firstOwner, 1_000);
    store.clear();
    expect(() =>
      store.consume([issued.selectionId], firstOwner, 1_001),
    ).toThrow(/expired/u);
  });
});
