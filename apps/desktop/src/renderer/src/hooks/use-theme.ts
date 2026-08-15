import { useEffect, useState } from "react";

/**
 * Theme selection.
 *
 * Three states, as the design requires: dark, light, and following the system.
 * The choice is written to the root element, which is where the token
 * stylesheet reads it from.
 */

export type ThemePreference = "dark" | "light" | "system";

const STORAGE_KEY = "codevault.theme";

function readStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  return stored === "dark" || stored === "light" || stored === "system"
    ? stored
    : "system";
}

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(),
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

    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  return { preference, setPreference: setPreferenceState };
}
