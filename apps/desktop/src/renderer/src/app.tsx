import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { LoginScreen } from "./features/auth/login-screen.js";
import { useTheme } from "./hooks/use-theme.js";
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

/**
 * Whether the preload bridge is present.
 *
 * Read once at module scope rather than in an effect: it is a property of how
 * the window was created and cannot change while the application is running.
 */
const BRIDGE_PRESENT = hasBridge();

export function App(): React.JSX.Element {
  useTheme();
  const queryClient = useMemo(() => createQueryClient(), []);
  const router = useMemo(() => createAppRouter(), []);
  const status = useSession((state) => state.status);
  const signIn = useSession((state) => state.signIn);
  const signOut = useSession((state) => state.signOut);
  const setStatus = useSession((state) => state.setStatus);

  useEffect(() => {
    if (!BRIDGE_PRESENT) {
      setStatus("SIGNED_OUT");

      return;
    }

    let cancelled = false;
    const unsubscribe = bridge().auth.onSessionExpired(signOut);

    void bridge()
      .auth.restore()
      .then((outcome) => {
        if (cancelled) {
          return;
        }

        if (outcome !== null && outcome.ok) {
          signIn(outcome.data.user, outcome.data.storageWarning);

          return;
        }

        setStatus("SIGNED_OUT");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("SIGNED_OUT");
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [signIn, signOut, setStatus]);

  if (!BRIDGE_PRESENT) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-[15px] font-semibold">
            The CodeVault Security desktop bridge is unavailable
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            This window is running outside the application shell, so it has no
            access to the server, the AI providers or the filesystem. Start
            CodeVault Security from the desktop application.
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
