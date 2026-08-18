import type { AppInstance } from "../../http/app-instance.js";

import { MeResponse, OkResponse } from "@codevault/contracts";

import { revokeSession } from "../../auth/session.js";
import { principalOf } from "../../http/guards.js";
import { registerLoginRoutes } from "./login-routes.js";
import { registerMigratedEnrollmentRoutes } from "./migrated-enrollment-routes.js";
import { registerEnrollmentRoutes } from "./enrollment-routes.js";
import { registerRecoveryRoutes } from "./recovery-routes.js";

export async function registerAuthRoutes(app: AppInstance): Promise<void> {
  await registerLoginRoutes(app);
  await registerMigratedEnrollmentRoutes(app);
  await registerEnrollmentRoutes(app);
  await registerRecoveryRoutes(app);

  app.post(
    "/v1/auth/logout",
    { schema: { response: { 200: OkResponse } } },
    async (request) => {
      const principal = principalOf(request);
      await revokeSession(app.db, principal.session.id);
      await app.audit.write(
        app.db,
        {
          organizationId: principal.organization.id,
          actorId: principal.user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "auth.logout",
          entityType: "user",
          entityId: principal.user.id,
        },
      );
      return { ok: true as const };
    },
  );

  app.get(
    "/v1/auth/me",
    { schema: { response: { 200: MeResponse } } },
    async (request) => {
      const principal = principalOf(request);
      return {
        user: {
          id: principal.user.id,
          email: principal.user.email,
          displayName: principal.user.displayName,
          role: principal.user.role,
          createdAt: principal.user.createdAt,
          lastLoginAt: principal.user.lastLoginAt,
        },
        session: principal.session,
      };
    },
  );
}
