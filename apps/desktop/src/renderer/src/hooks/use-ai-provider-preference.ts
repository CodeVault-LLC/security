import { useEffect, useState } from "react";

import type { AiProviderId } from "@codevault/contracts";

const STORAGE_KEY = "codevault.ai.default-provider";

function readStoredProvider(): AiProviderId | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  return stored === "claude-code" || stored === "codex-cli" ? stored : null;
}

/** The local provider a researcher prefers when more than one is available. */
export function useAiProviderPreference(): {
  providerId: AiProviderId | null;
  setProviderId: (providerId: AiProviderId | null) => void;
} {
  const [providerId, setProviderId] = useState<AiProviderId | null>(() =>
    readStoredProvider(),
  );

  useEffect(() => {
    if (providerId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, providerId);
    }
  }, [providerId]);

  return { providerId, setProviderId };
}
