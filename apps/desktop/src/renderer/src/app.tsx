import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { LoginScreen } from "./features/auth/login-screen.js";
import { createQueryClient } from "./lib/api.js";
import { hasBridge, bridge } from "./lib/bridge.js";
import { createAppRouter } from "./router.js";
import { useSession } from "./lib/session.js";

/**
 * The application root.
 *
 * Restores a stored session on start, then shows either the sign-in screen or
 * the workspace. The router is only mounted once signed in, so no authenticated
 * screen can render before there is a session to render it with.
 */

export function App(): React.JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), []);
  const router = useMemo(() => createAppRouter(), []);
  const status = useSession((state) => state.status);
  const signIn = useSession((state) => state.signIn);
  const setStatus = useSession((state) => state.setStatus);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    if (!hasBridge()) {
      setBridgeMissing(true);
      setStatus("SIGNED_OUT");

      return;
    }

    void bridge()
      .auth.restore()
      .then((outcome) => {
        if (outcome !== null && outcome.ok) {
          signIn(outcome.data.user, outcome.data.storageWarning);

          return;
        }

        setStatus("SIGNED_OUT");
      })
      .catch(() => setStatus("SIGNED_OUT"));
  }, [signIn, setStatus]);

  if (bridgeMissing) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-[15px] font-semibold">
            The CodeVault desktop bridge is unavailable
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            This window is running outside the application shell, so it has no
            access to the server, the AI providers or the filesystem. Start
            CodeVault from the desktop application.
          </p>
        </div>
      </div>
    );
  }

  if (status === "UNKNOWN") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[12px] text-text-muted">Restoring session…</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {status === "SIGNED_IN" ? (
        <RouterProvider router={router} />
      ) : (
        <LoginScreen />
      )}
    </QueryClientProvider>
  );
}
