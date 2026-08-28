import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, sql } from "drizzle-orm";

import {
  CreateInviteRequest,
  CreateInviteResponse,
  ErrorResponse,
  IdParam,
  Invite,
  OkResponse,
  UpdateUserRequest,
  UserSummary,
} from "@codevault/contracts";
import { DomainError, notFound, validationError } from "@codevault/core";
import { generateOpaqueToken } from "@codevault/core/crypto";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import { revokeAllSessionsForUser } from "../../auth/session.js";
import { revokeAllMcpAccessForUser } from "../../auth/mcp-access.js";
import { hashToken } from "../../auth/tokens.js";
import {
  assertUserHasPrivilegedKeyReadiness,
  lockPhishingResistantPolicy,
  organizationRequiresPhishingResistantMfa,
} from "../../auth/webauthn-policy.js";
import {
  principalOf,
  requireOrganizationAdminWithRecentMfa,
} from "../../http/guards.js";

/**
 * User and invitation administration.
 *
 * Only administrators reach these routes. Invitations are the sole path to a
 * new account, and their raw token is shown exactly once, at creation.
 */

const InviteListResponse = Type.Object({ items: Type.Array(Invite) });
const UserListResponse = Type.Object({ items: Type.Array(UserSummary) });

export async function registerUserRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/users",
    { schema: { response: { 200: UserListResponse } } },
    async (request) => {
      // Every authenticated user may see the roster: they need it to assign
      // case members and to read who approved a report.
      const principal = principalOf(request);

      const rows = await app.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          role: schema.organizationMemberships.role,
          disabled: schema.users.disabled,
          createdAt: schema.users.createdAt,
          lastLoginAt: schema.users.lastLoginAt,
        })
        .from(schema.users)
        .innerJoin(
          schema.organizationMemberships,
          eq(schema.organizationMemberships.userId, schema.users.id),
        )
        .where(
          eq(
            schema.organizationMemberships.organizationId,
            principal.organization.id,
          ),
        )
        .orderBy(schema.users.displayName);

      return { items: rows };
    },
  );

  app.patch(
    "/v1/users/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateUserRequest,
        response: {
          200: UserSummary,
          400: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const principal = principalOf(request);
      const { id } = request.params;
      const changes = request.body;

      const updated = await app.db.transaction(async (tx) => {
        if (changes.role === "ADMIN" || changes.disabled === false) {
          await lockPhishingResistantPolicy(tx, admin.organizationId);
        }
        const locked = await tx.execute<{
          id: string;
          email: string;
          display_name: string;
          disabled: boolean;
          created_at: string;
          last_login_at: string | null;
          role: "ADMIN" | "MEMBER" | "VIEWER";
        }>(sql`
          SELECT account.id, account.email, account.display_name,
            account.disabled, account.created_at, account.last_login_at,
            membership.role
          FROM users AS account
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          WHERE account.id = ${id}
            AND membership.organization_id = ${admin.organizationId}
          FOR UPDATE OF account, membership
        `);
        const existing = locked.rows[0];
        if (!existing) return undefined;
        if (existing.id === admin.id && changes.disabled === true) {
          throw validationError("You cannot disable your own account.");
        }
        if (
          existing.id === admin.id &&
          changes.role !== undefined &&
          changes.role !== "ADMIN"
        ) {
          throw validationError(
            "You cannot remove your own administrator role.",
          );
        }
        const nextRole = changes.role ?? existing.role;
        const nextDisabled = changes.disabled ?? existing.disabled;
        if (
          nextRole === "ADMIN" &&
          !nextDisabled &&
          (await organizationRequiresPhishingResistantMfa(
            tx,
            admin.organizationId,
          ))
        ) {
          await assertUserHasPrivilegedKeyReadiness(tx, id);
        }
        await tx
          .update(schema.users)
          .set({
            ...(changes.disabled === undefined
              ? {}
              : { disabled: changes.disabled }),
            ...(changes.displayName === undefined
              ? {}
              : { displayName: changes.displayName }),
            updatedAt: sql`now()`,
          })
          .where(eq(schema.users.id, id));

        if (changes.role !== undefined) {
          await tx
            .update(schema.organizationMemberships)
            .set({ role: changes.role })
            .where(
              and(
                eq(schema.organizationMemberships.userId, id),
                eq(
                  schema.organizationMemberships.organizationId,
                  admin.organizationId,
                ),
              ),
            );
        }

        const [result] = await tx
          .select({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
            role: schema.organizationMemberships.role,
            disabled: schema.users.disabled,
            createdAt: schema.users.createdAt,
            lastLoginAt: schema.users.lastLoginAt,
          })
          .from(schema.users)
          .innerJoin(
            schema.organizationMemberships,
            eq(schema.organizationMemberships.userId, schema.users.id),
          )
          .where(eq(schema.users.id, id))
          .limit(1);
        if (!result) {
          throw new DomainError("SERVER_ERROR", "Could not update the user.");
        }

        const authorityChanged =
          changes.disabled === true ||
          (changes.role !== undefined && changes.role !== existing.role);
        if (authorityChanged) {
          await revokeAllSessionsForUser(tx, id);
          await revokeAllMcpAccessForUser(tx, id);
        }
        await app.audit.write(
          tx,
          {
            actorId: admin.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action:
              changes.disabled === true ? "user.disabled" : "user.updated",
            entityType: "user",
            entityId: id,
            before: { role: existing.role, disabled: existing.disabled },
            after: { role: result.role, disabled: result.disabled },
          },
        );

        return result;
      });

      if (updated === undefined) {
        throw notFound("User");
      }

      return updated;
    },
  );

  app.get(
    "/v1/organization/invitations",
    { schema: { response: { 200: InviteListResponse } } },
    async (request) => {
      const principal = principalOf(request);

      const rows = await app.db
        .select({
          id: schema.invites.id,
          email: schema.invites.email,
          role: schema.invites.role,
          createdAt: schema.invites.createdAt,
          expiresAt: schema.invites.expiresAt,
          acceptedAt: schema.invites.acceptedAt,
          revokedAt: schema.invites.revokedAt,
          createdById: schema.users.id,
          createdByName: schema.users.displayName,
          createdByEmail: schema.users.email,
        })
        .from(schema.invites)
        .innerJoin(schema.users, eq(schema.users.id, schema.invites.createdBy))
        .where(eq(schema.invites.organizationId, principal.organization.id))
        .orderBy(desc(schema.invites.createdAt))
        .limit(200);

      return {
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          acceptedAt: row.acceptedAt,
          revokedAt: row.revokedAt,
          createdBy: {
            id: row.createdById,
            displayName: row.createdByName,
            email: row.createdByEmail,
          },
        })),
      };
    },
  );

  app.post(
    "/v1/organization/invitations",
    {
      schema: {
        body: CreateInviteRequest,
        response: {
          200: CreateInviteResponse,
          400: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const principal = principalOf(request);
      const { email, role } = request.body;
      const token = generateOpaqueToken();
      const created = await app.db.transaction(async (tx) => {
        await lockPhishingResistantPolicy(tx, admin.organizationId);
        const [policy] = await tx
          .select({
            inviteTtlHours: schema.organizationSecurityPolicies.inviteTtlHours,
            phishingResistantMfaRequired:
              schema.organizationSecurityPolicies.phishingResistantMfaRequired,
          })
          .from(schema.organizationSecurityPolicies)
          .where(
            eq(
              schema.organizationSecurityPolicies.organizationId,
              admin.organizationId,
            ),
          )
          .limit(1);
        if (!policy) {
          throw new DomainError(
            "SERVER_ERROR",
            "The organization security policy is missing.",
          );
        }
        if (role === "ADMIN" && policy.phishingResistantMfaRequired) {
          throw validationError(
            "Invite this person as a member, enroll two security keys, and then promote them to administrator.",
          );
        }
        const existing = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = lower(${email})`)
          .limit(1);
        if (existing.length > 0) {
          throw validationError("An account already exists for that address.");
        }
        const expiresAt = new Date(
          Date.now() + policy.inviteTtlHours * 60 * 60 * 1000,
        ).toISOString();
        const [created] = await tx
          .insert(schema.invites)
          .values({
            organizationId: admin.organizationId,
            email,
            role,
            tokenHash: hashToken(token),
            createdBy: admin.id,
            expiresAt,
          })
          .returning({
            id: schema.invites.id,
            email: schema.invites.email,
            role: schema.invites.role,
            createdAt: schema.invites.createdAt,
            expiresAt: schema.invites.expiresAt,
            acceptedAt: schema.invites.acceptedAt,
            revokedAt: schema.invites.revokedAt,
          });
        if (!created) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create the invitation.",
          );
        }
        await app.audit.write(
          tx,
          {
            actorId: admin.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "invite.created",
            entityType: "invite",
            entityId: created.id,
            after: { email, role, expiresAt },
          },
        );
        return created;
      });

      return {
        invite: {
          ...created,
          createdBy: {
            id: principal.user.id,
            displayName: principal.user.displayName,
            email: principal.user.email,
          },
        },
        // Shown once. Only the hash is stored, so this cannot be recovered.
        token,
      };
    },
  );

  app.delete(
    "/v1/organization/invitations/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: OkResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const principal = principalOf(request);
      const { id } = request.params;

      const [revoked] = await app.db
        .update(schema.invites)
        .set({ revokedAt: sql`now()`, revokedBy: admin.id })
        .where(
          and(
            eq(schema.invites.id, id),
            eq(schema.invites.organizationId, admin.organizationId),
          ),
        )
        .returning({ id: schema.invites.id });

      if (revoked === undefined) {
        throw notFound("Invitation");
      }

      await app.audit.write(
        app.db,
        {
          actorId: admin.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "invite.revoked",
          entityType: "invite",
          entityId: id,
        },
      );

      return { ok: true as const };
    },
  );
}
