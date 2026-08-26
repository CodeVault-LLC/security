import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiProviderPreference } from "./use-ai-provider-preference.js";
import { useTheme } from "./use-theme.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-motion");
});

afterEach(() => vi.restoreAllMocks());

describe("appearance preferences", () => {
  it("applies and persists scheme, accent, and reduced motion", async () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setPreference("dark");
      result.current.setAccent("ocean");
      result.current.setReduceMotion(true);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.dataset.accent).toBe("ocean");
      expect(document.documentElement.dataset.motion).toBe("reduced");
    });

    expect(localStorage.getItem("codevault.theme")).toBe("dark");
    expect(localStorage.getItem("codevault.accent")).toBe("ocean");
    expect(localStorage.getItem("codevault.reduce-motion")).toBe("true");
  });

  it("keeps appearance controls usable when preference storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe("system");
    expect(result.current.accent).toBe("default");
    expect(result.current.reduceMotion).toBe(false);

    act(() => {
      result.current.setPreference("dark");
      result.current.setAccent("iris");
      result.current.setReduceMotion(true);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.dataset.accent).toBe("iris");
      expect(document.documentElement.dataset.motion).toBe("reduced");
    });
  });
});

describe("AI provider preference", () => {
  it("persists a supported provider and removes automatic selection", async () => {
    const { result } = renderHook(() => useAiProviderPreference());

    act(() => result.current.setProviderId("claude-code"));
    await waitFor(() => {
      expect(localStorage.getItem("codevault.ai.default-provider")).toBe(
        "claude-code",
      );
    });

    act(() => result.current.setProviderId(null));
    await waitFor(() => {
      expect(localStorage.getItem("codevault.ai.default-provider")).toBeNull();
    });
  });
});
