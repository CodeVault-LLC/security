import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.js";

/**
 * Database client.
 *
 * One pool per process. The server and worker each create their own; nothing
 * else in the codebase constructs a `pg.Pool` directly.
 */

export interface DatabaseConfig {
  connectionString: string;
  /** Maximum pooled connections. Keep below the server's `max_connections`. */
  maxConnections?: number;
  /** Milliseconds to wait for a connection before failing a request. */
  connectionTimeoutMs?: number;
  /** Enables TLS. Required for any non-local deployment. */
  ssl?: boolean;
}

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(config: DatabaseConfig): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
    ...(config.ssl === true ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  // A pool-level error would otherwise crash the process on a dropped backend
  // connection, which happens routinely during database maintenance.
  pool.on("error", (error: Error) => {
    console.error("[db] idle client error", error.message);
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}

export { schema };
export type { pg };
