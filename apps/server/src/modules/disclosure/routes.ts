import type { AppInstance } from "../../http/app-instance.js";
import { asc, eq, sql } from "drizzle-orm";

import {
  CreateDisclosureEventRequest,
  CreateStakeholderRequest,
  DisclosureEvent,
  DisclosureOverview,
  ErrorResponse,
  IdParam,
  SetEmbargoRequest,
  Stakeholder,
} from "@codevault/contracts";
import { DomainError, validationError } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";

/**
 * Disclosure coordination routes.
 *
 * The timeline is structured events, so the vendor report and the public
 * advisory are generated from the same history instead of two hand-typed lists
 * that eventually disagree about when the vendor was contacted.
 */

/** How far ahead a planned date starts producing a warning. */
const WARNING_WINDOW_DAYS = 14;

export async function registerDisclosureRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/cases/:id/disclosure",
    {
      schema: {
        params: IdParam,
        response: { 200: DisclosureOverview, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      return loadDisclosureOverview(app.db, access.caseId);
    },
  );

  app.post(
    "/v1/cases/:id/stakeholders",
    {
      schema: {
        params: IdParam,
        body: CreateStakeholderRequest,
        response: { 200: Stakeholder },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);
      const body = request.body;

      const [row] = await app.db
        .insert(schema.stakeholders)
        .values({
          caseId: access.caseId,
          name: body.name,
          organisation: body.organisation ?? null,
          role: body.role,
          email: body.email ?? null,
          secureChannel: body.secureChannel ?? null,
          notes: body.notes ?? null,
          createdBy: user.id,
        })
        .returning();

      if (row === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not add the stakeholder.");
      }

      return toStakeholder(row);
    },
  );

  app.post(
    "/v1/cases/:id/disclosure-events",
    {
      schema: {
        params: IdParam,
        body: CreateDisclosureEventRequest,
        response: { 200: DisclosureEvent, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);
      const body = request.body;

      if (body.type === "CUSTOM" && body.label === undefined) {
        throw validationError("A custom event needs a label.");
      }

      if (body.type === "VENDOR_CONTACTED") {
        // The coordinated-disclosure policy pack requires a recorded contact
        // before this event, and the rule is enforced here rather than only in
        // the readiness view, because the timeline is the record of fact.
        const contacts = await app.db
          .select({ id: schema.stakeholders.id })
          .from(schema.stakeholders)
          .where(eq(schema.stakeholders.caseId, access.caseId))
          .limit(1);

        if (contacts.length === 0) {
          throw validationError(
            "Record the disclosure contact before logging that the vendor was contacted.",
          );
        }
      }

      const event = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.disclosureEvents)
          .values({
            caseId: access.caseId,
            findingId: body.findingId ?? null,
            type: body.type,
            label: body.label ?? null,
            occurredAt: body.occurredAt,
            detailMarkdown: body.detailMarkdown ?? null,
            stakeholderId: body.stakeholderId ?? null,
            artifactIds: body.artifactIds ?? [],
            visibility: body.visibility,
            recordedBy: user.id,
          })
          .returning();

        if (row === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not record the event.");
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "disclosure.event_recorded",
            entityType: "disclosure_event",
            entityId: row.id,
            caseId: access.caseId,
            after: { type: body.type, occurredAt: body.occurredAt },
          },
        );

        return row;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "disclosure",
        entityId: access.caseId,
        caseId: access.caseId,
      });

      return {
        id: event.id,
        caseId: event.caseId,
        findingId: event.findingId,
        type: event.type,
        label: event.label,
        occurredAt: event.occurredAt,
        detailMarkdown: event.detailMarkdown,
        stakeholderId: event.stakeholderId,
        stakeholderName: null,
        artifactIds: event.artifactIds,
        visibility: event.visibility,
        recordedBy: {
          id: principal.user.id,
          displayName: principal.user.displayName,
          email: principal.user.email,
        },
        createdAt: event.createdAt,
      };
    },
  );

  app.post(
    "/v1/cases/:id/embargo",
    {
      schema: {
        params: IdParam,
        body: SetEmbargoRequest,
        response: { 200: DisclosureOverview, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);
      const body = request.body;

      if (
        body.startsAt != null &&
        body.endsAt != null &&
        new Date(body.endsAt) < new Date(body.startsAt)
      ) {
        throw validationError("An embargo cannot end before it starts.");
      }

      const existing = await app.db
        .select()
        .from(schema.embargoes)
        .where(eq(schema.embargoes.caseId, access.caseId))
        .limit(1);

      const previous = existing[0];

      await app.db.transaction(async (tx) => {
        if (previous === undefined) {
          await tx.insert(schema.embargoes).values({
            caseId: access.caseId,
            startsAt: body.startsAt ?? null,
            endsAt: body.endsAt ?? null,
            plannedDisclosureAt: body.plannedDisclosureAt ?? null,
            expectedResponseAt: body.expectedResponseAt ?? null,
            agreementNote: body.agreementNote ?? null,
            updatedBy: user.id,
          });
        } else {
          await tx
            .update(schema.embargoes)
            .set({
              ...(body.startsAt === undefined
                ? {}
                : { startsAt: body.startsAt }),
              ...(body.endsAt === undefined ? {} : { endsAt: body.endsAt }),
              ...(body.plannedDisclosureAt === undefined
                ? {}
                : { plannedDisclosureAt: body.plannedDisclosureAt }),
              ...(body.expectedResponseAt === undefined
                ? {}
                : { expectedResponseAt: body.expectedResponseAt }),
              ...(body.agreementNote === undefined
                ? {}
                : { agreementNote: body.agreementNote }),
              updatedBy: user.id,
              revision: previous.revision + 1,
              updatedAt: sql`now()`,
            })
            .where(eq(schema.embargoes.id, previous.id));
        }

        // Disclosure dates are commitments to a vendor, so every change to one
        // is audited with both the old and the new value.
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "disclosure.dates_changed",
            entityType: "embargo",
            entityId: previous?.id ?? access.caseId,
            caseId: access.caseId,
            before:
              previous === undefined
                ? null
                : {
                    plannedDisclosureAt: previous.plannedDisclosureAt,
                    endsAt: previous.endsAt,
                  },
            after: {
              plannedDisclosureAt: body.plannedDisclosureAt ?? null,
              endsAt: body.endsAt ?? null,
            },
          },
        );
      });

      return loadDisclosureOverview(app.db, access.caseId);
    },
  );
}

/** Assembles the whole disclosure picture for one case. */
export async function loadDisclosureOverview(
  db: Database,
  caseId: string,
): Promise<DisclosureOverview> {
  const stakeholders = await db
    .select()
    .from(schema.stakeholders)
    .where(eq(schema.stakeholders.caseId, caseId))
    .orderBy(asc(schema.stakeholders.createdAt));

  const eventRows = await db
    .select({
      event: schema.disclosureEvents,
      recorderId: schema.users.id,
      recorderName: schema.users.displayName,
      recorderEmail: schema.users.email,
      stakeholderName: schema.stakeholders.name,
    })
    .from(schema.disclosureEvents)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.disclosureEvents.recordedBy),
    )
    .leftJoin(
      schema.stakeholders,
      eq(schema.stakeholders.id, schema.disclosureEvents.stakeholderId),
    )
    .where(eq(schema.disclosureEvents.caseId, caseId))
    .orderBy(asc(schema.disclosureEvents.occurredAt));

  const embargoRows = await db
    .select({
      embargo: schema.embargoes,
      userId: schema.users.id,
      userName: schema.users.displayName,
      userEmail: schema.users.email,
    })
    .from(schema.embargoes)
    .innerJoin(schema.users, eq(schema.users.id, schema.embargoes.updatedBy))
    .where(eq(schema.embargoes.caseId, caseId))
    .limit(1);

  const embargoRow = embargoRows[0];

  return {
    caseId,
    stakeholders: stakeholders.map(toStakeholder),
    events: eventRows.map(
      ({
        event,
        recorderId,
        recorderName,
        recorderEmail,
        stakeholderName,
      }) => ({
        id: event.id,
        caseId: event.caseId,
        findingId: event.findingId,
        type: event.type,
        label: event.label,
        occurredAt: event.occurredAt,
        detailMarkdown: event.detailMarkdown,
        stakeholderId: event.stakeholderId,
        stakeholderName,
        artifactIds: event.artifactIds,
        visibility: event.visibility,
        recordedBy: {
          id: recorderId,
          displayName: recorderName,
          email: recorderEmail,
        },
        createdAt: event.createdAt,
      }),
    ),
    embargo:
      embargoRow === undefined
        ? null
        : {
            id: embargoRow.embargo.id,
            caseId: embargoRow.embargo.caseId,
            startsAt: embargoRow.embargo.startsAt,
            endsAt: embargoRow.embargo.endsAt,
            plannedDisclosureAt: embargoRow.embargo.plannedDisclosureAt,
            expectedResponseAt: embargoRow.embargo.expectedResponseAt,
            agreementNote: embargoRow.embargo.agreementNote,
            updatedBy: {
              id: embargoRow.userId,
              displayName: embargoRow.userName,
              email: embargoRow.userEmail,
            },
            updatedAt: embargoRow.embargo.updatedAt,
            revision: embargoRow.embargo.revision,
          },
    warnings: buildWarnings(embargoRow?.embargo ?? null, stakeholders.length),
  };
}

type StakeholderRow = typeof schema.stakeholders.$inferSelect;

function toStakeholder(row: StakeholderRow): Stakeholder {
  return {
    id: row.id,
    caseId: row.caseId,
    name: row.name,
    organisation: row.organisation,
    role: row.role,
    email: row.email,
    secureChannel: row.secureChannel,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type EmbargoRow = typeof schema.embargoes.$inferSelect;

/**
 * Derived warnings.
 *
 * V1 surfaces these in the UI and nowhere else — no email, no webhook. A tool
 * that quietly told a third party that an embargo was expiring would be a
 * disclosure of its own.
 */
function buildWarnings(
  embargo: EmbargoRow | null,
  stakeholderCount: number,
): DisclosureOverview["warnings"] {
  const warnings: DisclosureOverview["warnings"] = [];

  if (stakeholderCount === 0) {
    warnings.push({
      code: "NO_DISCLOSURE_CONTACT",
      message: "No disclosure contact has been recorded for this case.",
      dueAt: null,
    });
  }

  if (embargo === null) {
    return warnings;
  }

  const now = Date.now();
  const windowMs = WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  if (embargo.expectedResponseAt !== null) {
    const due = new Date(embargo.expectedResponseAt).getTime();

    if (due < now) {
      warnings.push({
        code: "VENDOR_RESPONSE_OVERDUE",
        message: "The expected vendor response date has passed.",
        dueAt: embargo.expectedResponseAt,
      });
    } else if (due - now <= windowMs) {
      warnings.push({
        code: "VENDOR_RESPONSE_DUE",
        message: "The expected vendor response is due shortly.",
        dueAt: embargo.expectedResponseAt,
      });
    }
  }

  if (embargo.plannedDisclosureAt !== null) {
    const planned = new Date(embargo.plannedDisclosureAt).getTime();

    if (planned < now) {
      warnings.push({
        code: "DISCLOSURE_DATE_PASSED",
        message: "The planned disclosure date has passed.",
        dueAt: embargo.plannedDisclosureAt,
      });
    } else if (planned - now <= windowMs) {
      warnings.push({
        code: "DISCLOSURE_APPROACHING",
        message: "The planned disclosure date is approaching.",
        dueAt: embargo.plannedDisclosureAt,
      });
    }
  }

  return warnings;
}
