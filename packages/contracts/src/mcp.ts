import { Type, type Static } from "@sinclair/typebox";

import { Timestamp, Uuid } from "./common.js";

export const CreateMcpAccessTokenRequest = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
});
export type CreateMcpAccessTokenRequest = Static<
  typeof CreateMcpAccessTokenRequest
>;

export const McpAccessToken = Type.Object({
  id: Uuid,
  name: Type.String(),
  createdAt: Timestamp,
  lastUsedAt: Type.Union([Timestamp, Type.Null()]),
});
export type McpAccessToken = Static<typeof McpAccessToken>;

export const McpAccessTokenList = Type.Object({
  items: Type.Array(McpAccessToken),
});

export const CreateMcpAccessTokenResponse = Type.Object({
  access: McpAccessToken,
  token: Type.String({ pattern: "^cv_mcp_[A-Za-z0-9_-]{32,}$" }),
});
export type CreateMcpAccessTokenResponse = Static<
  typeof CreateMcpAccessTokenResponse
>;
