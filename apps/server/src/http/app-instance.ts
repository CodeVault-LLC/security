import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";

/**
 * The application's Fastify instance type.
 *
 * Route modules take this rather than a bare `FastifyInstance` so the TypeBox
 * type provider survives the hand-off. Without it, `request.body` degrades to
 * `unknown` inside every handler and the schemas stop being load-bearing for
 * anything but runtime validation.
 */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;
