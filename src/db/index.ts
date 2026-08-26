import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Serverless functions are recycled constantly, so the client is cached on
 * `globalThis` to stop every invocation opening a fresh pool against Neon.
 * `prepare: false` is required when talking through a transaction pooler.
 */
const globalForDb = globalThis as unknown as {
  __pp_sql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__pp_sql ??
  postgres(env.DATABASE_URL, { max: 5, prepare: false, idle_timeout: 20 });

if (process.env.NODE_ENV !== "production") globalForDb.__pp_sql = client;

export const db = drizzle(client, { schema });
export { client as sql };
export * from "./schema";
