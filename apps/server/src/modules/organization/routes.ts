import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, sql } from "drizzle-orm";

import {
  ErrorResponse,
  OrganizationSecurityPolicy,
  OrganizationSettings,
  OrganizationUser,
  OrganizationUserList,
  UpdateOrganizationSecurityPolicy,
  UpdateOrganizationSettings,
  UpdateUserRequest,
} from "@codevault/contracts";
import { notFound, validationError } from "@codevault/core";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import { revokeAllSessionsForUser } from "../../auth/session.js";
import { revokeAllMcpAccessForUser } from "../../auth/mcp-access.js";
import {
  principalOf,
  requireOrganizationAdminWithRecentMfa,
  requireRecentPhishingResistantMfa,
} from "../../http/guards.js";
import {
  assertOrganizationAdminKeyReadiness,
  assertUserHasPrivilegedKeyReadiness,
  lockPhishingResistantPolicy,
  organizationRequiresPhishingResistantMfa,
} from "../../auth/webauthn-policy.js";

const Id = Type.Object({ id: Type.String({ format: "uuid" }) });

const currentUserAvatarId = sql<string | null>`(
  SELECT avatar.id FROM avatar_images AS avatar
  WHERE avatar.target_user_id = ${schema.users.id} AND avatar.status = 'READY'
  LIMIT 1
)`;

async function organizationAvatarId(app: AppInstance, organizationId: string) {
  const [row] = await app.db
    .select({ id: schema.avatarImages.id })
    .from(schema.avatarImages)
    .where(
      and(
        eq(schema.avatarImages.targetOrganizationId, organizationId),
        eq(schema.avatarImages.status, "READY"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function registerOrganizationRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/organization/users",
    { schema: { response: { 200: OrganizationUserList } } },
    async (request) => {
      const principal = principalOf(request);
      const rows = await app.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          role: schema.organizationMemberships.role,
          disabled: schema.users.disabled,
          joinedAt: schema.organizationMemberships.joinedAt,
          lastLoginAt: schema.users.lastLoginAt,
          avatarId: currentUserAvatarId,
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

  app.get(
    "/v1/organization/users/:id",
    {
      schema: {
        params: Id,
        response: { 200: OrganizationUser, 404: ErrorResponse },
      },
    },
    async (request) => {
      const principal = principalOf(request);
      const [row] = await app.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          role: schema.organizationMemberships.role,
          disabled: schema.users.disabled,
          joinedAt: schema.organizationMemberships.joinedAt,
          lastLoginAt: schema.users.lastLoginAt,
          avatarId: currentUserAvatarId,
        })
        .from(schema.users)
        .innerJoin(
          schema.organizationMemberships,
          eq(schema.organizationMemberships.userId, schema.users.id),
        )
        .where(
          and(
            eq(schema.users.id, request.params.id),
            eq(
              schema.organizationMemberships.organizationId,
              principal.organization.id,
            ),
          ),
        )
        .limit(1);
      if (!row) throw notFound("User");
      return row;
    },
  );

  app.patch(
    "/v1/organization/users/:id",
    {
      schema: {
        params: Id,
        body: UpdateUserRequest,
        response: {
          200: OrganizationUser,
          400: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const principal = principalOf(request);
      if (
        request.params.id === admin.id &&
        (request.body.disabled === true ||
          (request.body.role && request.body.role !== "ADMIN"))
      ) {
        throw validationError(
          "You cannot disable or demote your own administrator account.",
        );
      }
      const row = await app.db.transaction(async (tx) => {
        const enteringPrivilegedRole =
          request.body.role === "ADMIN" || request.body.disabled === false;
        if (enteringPrivilegedRole) {
          await lockPhishingResistantPolicy(tx, admin.organizationId);
        }
        const locked = await tx.execute<{
          id: string;
          disabled: boolean;
          role: "ADMIN" | "MEMBER" | "VIEWER";
        }>(sql`
          SELECT account.id, account.disabled, membership.role
          FROM users AS account
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          WHERE account.id = ${request.params.id} AND membership.organization_id = ${admin.organizationId}
          FOR UPDATE OF account, membership
        `);
        const current = locked.rows[0];
        if (!current) return null;
        const nextRole = request.body.role ?? current.role;
        const nextDisabled = request.body.disabled ?? current.disabled;
        if (
          enteringPrivilegedRole &&
          nextRole === "ADMIN" &&
          !nextDisabled &&
          (await organizationRequiresPhishingResistantMfa(
            tx,
            admin.organizationId,
          ))
        ) {
          await assertUserHasPrivilegedKeyReadiness(tx, request.params.id);
        }
        if (
          request.body.displayName !== undefined ||
          request.body.disabled !== undefined
        ) {
          await tx
            .update(schema.users)
            .set({
              ...(request.body.displayName === undefined
                ? {}
                : { displayName: request.body.displayName }),
              ...(request.body.disabled === undefined
                ? {}
                : { disabled: request.body.disabled }),
              updatedAt: sql`now()`,
            })
            .where(eq(schema.users.id, request.params.id));
        }
        if (request.body.role !== undefined) {
          await tx
            .update(schema.organizationMemberships)
            .set({ role: request.body.role })
            .where(
              and(
                eq(schema.organizationMemberships.userId, request.params.id),
                eq(
                  schema.organizationMemberships.organizationId,
                  admin.organizationId,
                ),
              ),
            );
        }
        const [updated] = await tx
          .select({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
            role: schema.organizationMemberships.role,
            disabled: schema.users.disabled,
            joinedAt: schema.organizationMemberships.joinedAt,
            lastLoginAt: schema.users.lastLoginAt,
            avatarId: currentUserAvatarId,
          })
          .from(schema.users)
          .innerJoin(
            schema.organizationMemberships,
            eq(schema.organizationMemberships.userId, schema.users.id),
          )
          .where(eq(schema.users.id, request.params.id))
          .limit(1);
        if (!updated) return null;
        const authorityChanged =
          request.body.disabled === true ||
          (request.body.role !== undefined &&
            request.body.role !== current.role);
        if (authorityChanged) {
          await revokeAllSessionsForUser(tx, request.params.id);
          await revokeAllMcpAccessForUser(tx, request.params.id);
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
              request.body.disabled === true ? "user.disabled" : "user.updated",
            entityType: "user",
            entityId: request.params.id,
            before: { role: current.role, disabled: current.disabled },
            after: { role: updated.role, disabled: updated.disabled },
          },
        );
        return updated;
      });
      if (!row) throw notFound("User");
      return row;
    },
  );

  app.get(
    "/v1/organization/settings",
    { schema: { response: { 200: OrganizationSettings } } },
    async (request) => {
      const principal = principalOf(request);
      const [organization] = await app.db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, principal.organization.id));
      return {
        ...organization!,
        avatarId: await organizationAvatarId(app, principal.organization.id),
      };
    },
  );

  app.patch(
    "/v1/organization/settings",
    {
      schema: {
        body: UpdateOrganizationSettings,
        response: { 200: OrganizationSettings, 403: ErrorResponse },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const [organization] = await app.db
        .update(schema.organizations)
        .set({
          ...(request.body.name === undefined
            ? {}
            : { name: request.body.name.trim() }),
          ...(request.body.contactName === undefined
            ? {}
            : { contactName: request.body.contactName?.trim() ?? null }),
          ...(request.body.contactEmail === undefined
            ? {}
            : {
                contactEmail:
                  request.body.contactEmail?.trim().toLowerCase() ?? null,
              }),
          ...(request.body.reportFooter === undefined
            ? {}
            : { reportFooter: request.body.reportFooter?.trim() ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(schema.organizations.id, admin.organizationId))
        .returning();
      return {
        ...organization!,
        avatarId: await organizationAvatarId(app, admin.organizationId),
      };
    },
  );

  app.get(
    "/v1/organization/security",
    { schema: { response: { 200: OrganizationSecurityPolicy } } },
    async (request) => {
      const principal = principalOf(request);
      const [policy] = await app.db
        .select()
        .from(schema.organizationSecurityPolicies)
        .where(
          eq(
            schema.organizationSecurityPolicies.organizationId,
            principal.organization.id,
          ),
        );
      return {
        mfaRequired: policy!.mfaRequired,
        phishingResistantMfaRequired: policy!.phishingResistantMfaRequired,
        inviteTtlHours: policy!.inviteTtlHours,
        sessionIdleMinutes: policy!.sessionIdleMinutes,
        sessionAbsoluteHours: policy!.sessionAbsoluteHours,
        recentMfaMinutes: policy!.recentMfaMinutes,
        mcpEnabled: policy!.mcpEnabled,
        mailHtmlRenderingEnabled: policy!.mailHtmlRenderingEnabled,
        updatedAt: policy!.updatedAt,
      };
    },
  );

  app.patch(
    "/v1/organization/security",
    {
      schema: {
        body: UpdateOrganizationSecurityPolicy,
        response: {
          200: OrganizationSecurityPolicy,
          400: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const principal = principalOf(request);
      const policy = await app.db.transaction(async (tx) => {
        await lockPhishingResistantPolicy(tx, admin.organizationId);
        const locked = await tx.execute<{
          mfa_required: boolean;
          phishing_resistant_mfa_required: boolean;
        }>(sql`
          SELECT mfa_required, phishing_resistant_mfa_required
          FROM organization_security_policies
          WHERE organization_id = ${admin.organizationId}
          FOR UPDATE
        `);
        const current = locked.rows[0];
        if (!current) {
          throw new Error("The organization security policy is missing.");
        }
        const nextPhishingResistant =
          request.body.phishingResistantMfaRequired ??
          current.phishing_resistant_mfa_required;
        const nextMfaRequired =
          request.body.mfaRequired ?? current.mfa_required;
        if (nextPhishingResistant && !nextMfaRequired) {
          throw validationError(
            "Multi-factor authentication must remain enabled while phishing-resistant MFA is required.",
          );
        }
        if (
          request.body.phishingResistantMfaRequired === true &&
          !current.phishing_resistant_mfa_required
        ) {
          await assertOrganizationAdminKeyReadiness(tx, admin.organizationId);
          requireRecentPhishingResistantMfa(request);
        }

        const [updated] = await tx
          .update(schema.organizationSecurityPolicies)
          .set({
            ...request.body,
            updatedBy: admin.id,
            updatedAt: sql`now()`,
          })
          .where(
            eq(
              schema.organizationSecurityPolicies.organizationId,
              admin.organizationId,
            ),
          )
          .returning();
        await tx.execute(sql`
          UPDATE sessions SET revoked_at = now()
          WHERE revoked_at IS NULL AND created_at < now() - (${updated!.sessionAbsoluteHours}::text || ' hours')::interval
        `);
        if (request.body.mfaRequired === true) {
          await tx.execute(sql`
            UPDATE sessions AS session SET revoked_at = now()
            FROM organization_memberships AS membership
            WHERE session.user_id = membership.user_id
              AND membership.organization_id = ${admin.organizationId}
              AND session.revoked_at IS NULL
              AND session.mfa_method = 'PASSWORD'
          `);
        }
        if (
          request.body.phishingResistantMfaRequired === true &&
          !current.phishing_resistant_mfa_required
        ) {
          await tx.execute(sql`
            UPDATE sessions AS session SET revoked_at = now()
            FROM organization_memberships AS membership
            WHERE session.user_id = membership.user_id
              AND membership.organization_id = ${admin.organizationId}
              AND membership.role = 'ADMIN'
              AND session.revoked_at IS NULL
              AND session.mfa_method <> 'WEBAUTHN'
          `);
          await tx.execute(sql`
            UPDATE mcp_access_tokens AS access SET revoked_at = now()
            FROM organization_memberships AS membership
            WHERE access.user_id = membership.user_id
              AND membership.organization_id = ${admin.organizationId}
              AND membership.role = 'ADMIN'
              AND access.revoked_at IS NULL
          `);
        }
        if (
          request.body.phishingResistantMfaRequired !== undefined &&
          request.body.phishingResistantMfaRequired !==
            current.phishing_resistant_mfa_required
        ) {
          await app.audit.write(
            tx,
            {
              actorId: admin.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "organization.phishing_resistant_mfa_changed",
              entityType: "organization_security_policy",
              entityId: admin.organizationId,
              before: {
                required: current.phishing_resistant_mfa_required,
              },
              after: {
                required: updated!.phishingResistantMfaRequired,
              },
            },
          );
        }
        return updated!;
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "organization_security_policy",
        entityId: admin.organizationId,
        caseId: null,
        detail: {
          mailHtmlRenderingEnabled: policy!.mailHtmlRenderingEnabled,
          phishingResistantMfaRequired: policy!.phishingResistantMfaRequired,
        },
      });
      return {
        mfaRequired: policy!.mfaRequired,
        phishingResistantMfaRequired: policy!.phishingResistantMfaRequired,
        inviteTtlHours: policy!.inviteTtlHours,
        sessionIdleMinutes: policy!.sessionIdleMinutes,
        sessionAbsoluteHours: policy!.sessionAbsoluteHours,
        recentMfaMinutes: policy!.recentMfaMinutes,
        mcpEnabled: policy!.mcpEnabled,
        mailHtmlRenderingEnabled: policy!.mailHtmlRenderingEnabled,
        updatedAt: policy!.updatedAt,
      };
    },
  );
}
