import { Type, type Static } from "@sinclair/typebox";

import { Timestamp, Uuid } from "./common.js";

export const VendorResponseSla = Type.Object({
  submissionId: Uuid,
  status: Type.Union([
    Type.Literal("NOT_STARTED"),
    Type.Literal("AWAITING_ACKNOWLEDGEMENT"),
    Type.Literal("ACKNOWLEDGEMENT_OVERDUE"),
    Type.Literal("AWAITING_UPDATE"),
    Type.Literal("UPDATE_OVERDUE"),
    Type.Literal("NO_UPDATE_CADENCE"),
  ]),
  acknowledgementBusinessDays: Type.Integer({ minimum: 1 }),
  updateCadenceDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  sentAt: Type.Union([Timestamp, Type.Null()]),
  acknowledgementDueAt: Type.Union([Timestamp, Type.Null()]),
  firstResponseAt: Type.Union([Timestamp, Type.Null()]),
  lastResponseAt: Type.Union([Timestamp, Type.Null()]),
  nextUpdateDueAt: Type.Union([Timestamp, Type.Null()]),
  remainingDays: Type.Union([Type.Integer(), Type.Null()]),
});
export type VendorResponseSla = Static<typeof VendorResponseSla>;
