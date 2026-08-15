import { create } from "zustand";

import type { SessionUser } from "@codevault/contracts";

/**
 * Ephemeral desktop state.
 *
 * The only global store in the renderer, and it holds exactly three things:
 * who is signed in, whether the event stream is live, and whether the session
 * could be stored securely. Server data never comes near it — that belongs to
 * TanStack Query.
 */

export type SessionStatus = "UNKNOWN" | "SIGNED_OUT" | "SIGNED_IN";

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Set when the platform could not store the session securely. */
  storageWarning: string | null;
  eventsConnected: boolean;
  signIn(user: SessionUser, storageWarning: string | null): void;
  signOut(): void;
  setStatus(status: SessionStatus): void;
  setEventsConnected(connected: boolean): void;
}

export const useSession = create<SessionState>((set) => ({
  status: "UNKNOWN",
  user: null,
  storageWarning: null,
  eventsConnected: false,

  signIn(user, storageWarning) {
    set({ status: "SIGNED_IN", user, storageWarning });
  },

  signOut() {
    set({
      status: "SIGNED_OUT",
      user: null,
      storageWarning: null,
      eventsConnected: false,
    });
  },

  setStatus(status) {
    set({ status });
  },

  setEventsConnected(eventsConnected) {
    set({ eventsConnected });
  },
}));

/** Whether the signed-in user may create or edit research data. */
export function canWrite(user: SessionUser | null): boolean {
  return user !== null && (user.role === "ADMIN" || user.role === "MEMBER");
}

export function isAdmin(user: SessionUser | null): boolean {
  return user !== null && user.role === "ADMIN";
}
