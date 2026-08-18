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
import {
  principalOf,
  requireOrganizationAdminWithRecentMfa,
} from "../../http/guards.js";

const Id = Type.Object({ id: Type.String({ format: "uuid" }) });

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
      return { items: rows.map((row) => ({ ...row, avatarId: null })) };
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
      return { ...row, avatarId: null };
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
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
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
        const locked = await tx.execute<{ id: string }>(sql`
          SELECT account.id FROM users AS account
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          WHERE account.id = ${request.params.id} AND membership.organization_id = ${admin.organizationId}
          FOR UPDATE OF account, membership
        `);
        if (!locked.rows[0]) return null;
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
          })
          .from(schema.users)
          .innerJoin(
            schema.organizationMemberships,
            eq(schema.organizationMemberships.userId, schema.users.id),
          )
          .where(eq(schema.users.id, request.params.id))
          .limit(1);
        return updated;
      });
      if (!row) throw notFound("User");
      if (request.body.disabled === true || request.body.role !== undefined)
        await revokeAllSessionsForUser(app.db, row.id);
      return { ...row, avatarId: null };
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
      return { ...organization!, avatarId: null };
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
        .set({ name: request.body.name.trim(), updatedAt: sql`now()` })
        .where(eq(schema.organizations.id, admin.organizationId))
        .returning();
      return { ...organization!, avatarId: null };
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
        mfaRequired: true as const,
        inviteTtlHours: policy!.inviteTtlHours,
        sessionIdleMinutes: policy!.sessionIdleMinutes,
        sessionAbsoluteHours: policy!.sessionAbsoluteHours,
        recentMfaMinutes: policy!.recentMfaMinutes,
        updatedAt: policy!.updatedAt,
      };
    },
  );

  app.patch(
    "/v1/organization/security",
    {
      schema: {
        body: UpdateOrganizationSecurityPolicy,
        response: { 200: OrganizationSecurityPolicy, 403: ErrorResponse },
      },
    },
    async (request) => {
      const admin = requireOrganizationAdminWithRecentMfa(request);
      const [policy] = await app.db
        .update(schema.organizationSecurityPolicies)
        .set({
          ...request.body,
          mfaRequired: true,
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
      await app.db.execute(sql`
      UPDATE sessions SET revoked_at = now()
      WHERE revoked_at IS NULL AND created_at < now() - (${policy!.sessionAbsoluteHours}::text || ' hours')::interval
    `);
      return {
        mfaRequired: true as const,
        inviteTtlHours: policy!.inviteTtlHours,
        sessionIdleMinutes: policy!.sessionIdleMinutes,
        sessionAbsoluteHours: policy!.sessionAbsoluteHours,
        recentMfaMinutes: policy!.recentMfaMinutes,
        updatedAt: policy!.updatedAt,
      };
    },
  );
}
