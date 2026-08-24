import type { AppInstance } from "../../http/app-instance.js";

import { MeResponse, OkResponse } from "@codevault/contracts";

import { revokeSession } from "../../auth/session.js";
import { revokeMcpAccess } from "../../auth/mcp-access.js";
import { principalOf } from "../../http/guards.js";
import { registerLoginRoutes } from "./login-routes.js";
import { registerMigratedEnrollmentRoutes } from "./migrated-enrollment-routes.js";
import { registerEnrollmentRoutes } from "./enrollment-routes.js";
import { registerRecoveryRoutes } from "./recovery-routes.js";
import { registerWebAuthnRoutes } from "./webauthn-routes.js";

export async function registerAuthRoutes(app: AppInstance): Promise<void> {
  await registerLoginRoutes(app);
  await registerMigratedEnrollmentRoutes(app);
  await registerEnrollmentRoutes(app);
  await registerRecoveryRoutes(app);
  await registerWebAuthnRoutes(app);

  app.post(
    "/v1/auth/logout",
    { schema: { response: { 200: OkResponse } } },
    async (request) => {
      const principal = principalOf(request);
      if (principal.authentication.kind === "MCP") {
        await revokeMcpAccess(
          app.db,
          principal.user.id,
          principal.authentication.id,
        );
      } else {
        await revokeSession(app.db, principal.authentication.id);
      }
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
