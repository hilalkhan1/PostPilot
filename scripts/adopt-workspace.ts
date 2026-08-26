/**
 * Attach a signed-up account to the workspace that already holds the connected
 * social accounts.
 *
 *   npm run adopt -- you@example.com
 *
 * Only needed once, when moving from the old single-workspace dev stub to real
 * accounts: the connections hang off the organisation, not the user, so they
 * survive the migration — but the new account signs up into a fresh, empty
 * workspace and would not see them.
 *
 * Also clears out organisations with no members and no connections, which the
 * blank-environment-variable bug left behind.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  memberships,
  organizations,
  platformConnections,
  socialAccounts,
  users,
} from "../src/db/schema";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run adopt -- you@example.com");
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(
      `No account with email ${email}. Sign up in the app first, then run this.`,
    );
    process.exit(1);
  }
  console.log(`user: ${user.email} (${user.id})`);

  // The workspace worth keeping is the one with connected accounts in it.
  const withConnections = await db
    .selectDistinct({ orgId: platformConnections.orgId })
    .from(platformConnections);

  if (withConnections.length === 0) {
    console.error("No organisation has any connected accounts. Nothing to adopt.");
    process.exit(1);
  }
  if (withConnections.length > 1) {
    console.error(
      `More than one organisation has connections (${withConnections
        .map((o) => o.orgId)
        .join(", ")}). Refusing to guess — pick one by hand.`,
    );
    process.exit(1);
  }

  const targetOrgId = withConnections[0].orgId;
  const [target] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, targetOrgId))
    .limit(1);

  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.orgId, targetOrgId));

  console.log(`workspace: "${target.name}" (${targetOrgId})`);
  for (const a of accounts) {
    console.log(`  ${a.platform.padEnd(10)} ${a.displayName}`);
  }

  // Any workspace this user was auto-given on first sign-in, other than the
  // target, is empty by definition and should not linger.
  const theirs = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  const strays = theirs
    .map((m) => m.orgId)
    .filter((id) => id !== targetOrgId);

  await db
    .insert(memberships)
    .values({ orgId: targetOrgId, userId: user.id, role: "owner" })
    .onConflictDoNothing();
  console.log(`\nattached ${user.email} to "${target.name}" as owner`);

  for (const orgId of strays) {
    await db.delete(organizations).where(eq(organizations.id, orgId));
    console.log(`  removed their empty auto-created workspace ${orgId}`);
  }

  // Sweep organisations left with no members at all.
  const orphans = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .leftJoin(memberships, eq(memberships.orgId, organizations.id))
    .where(isNull(memberships.id));

  for (const orphan of orphans) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformConnections)
      .where(eq(platformConnections.orgId, orphan.id));

    if (count > 0) {
      console.log(`  keeping orphan ${orphan.id} — it still has connections`);
      continue;
    }
    await db.delete(organizations).where(eq(organizations.id, orphan.id));
    console.log(`  removed memberless empty workspace "${orphan.name}" (${orphan.id})`);
  }

  console.log("\nDone. Reload the app.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
