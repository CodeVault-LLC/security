import { useEffect, useState } from "react";

/**
 * Theme selection.
 *
 * Three states, as the design requires: dark, light, and following the system.
 * The choice is written to the root element, which is where the token
 * stylesheet reads it from.
 */

export type ThemePreference = "dark" | "light" | "system";
export type AccentPreference = "default" | "ocean" | "ember" | "iris";

const THEME_STORAGE_KEY = "codevault.theme";
const ACCENT_STORAGE_KEY = "codevault.accent";
const MOTION_STORAGE_KEY = "codevault.reduce-motion";

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences still apply for the current session when storage is blocked.
  }
}

function readStoredPreference(): ThemePreference {
  const stored = readPreference(THEME_STORAGE_KEY);

  return stored === "dark" || stored === "light" || stored === "system"
    ? stored
    : "system";
}

function readStoredAccent(): AccentPreference {
  const stored = readPreference(ACCENT_STORAGE_KEY);

  return stored === "ocean" || stored === "ember" || stored === "iris"
    ? stored
    : "default";
}

function readStoredMotionPreference(): boolean {
  return readPreference(MOTION_STORAGE_KEY) === "true";
}

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  accent: AccentPreference;
  setAccent: (accent: AccentPreference) => void;
  reduceMotion: boolean;
  setReduceMotion: (reduced: boolean) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(),
  );
  const [accent, setAccentState] = useState<AccentPreference>(() =>
    readStoredAccent(),
  );
  const [reduceMotion, setReduceMotionState] = useState(() =>
    readStoredMotionPreference(),
  );

  useEffect(() => {
    const root = document.documentElement;

    if (preference === "system") {
      // No attribute at all: the stylesheet's `prefers-color-scheme` block
      // takes over, which is what "follow the system" actually means.
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", preference);
    }

    storePreference(THEME_STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    const root = document.documentElement;

    if (accent === "default") {
      root.removeAttribute("data-accent");
    } else {
      root.setAttribute("data-accent", accent);
    }

    storePreference(ACCENT_STORAGE_KEY, accent);
  }, [accent]);

  useEffect(() => {
    const root = document.documentElement;

    if (reduceMotion) {
      root.setAttribute("data-motion", "reduced");
    } else {
      root.removeAttribute("data-motion");
    }

    storePreference(MOTION_STORAGE_KEY, String(reduceMotion));
  }, [reduceMotion]);

  return {
    preference,
    setPreference: setPreferenceState,
    accent,
    setAccent: setAccentState,
    reduceMotion,
    setReduceMotion: setReduceMotionState,
  };
}
