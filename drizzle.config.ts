import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit does not read .env.local (the Next.js convention) on its own, so
// without this every db:push fails with "connection url is required".
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
