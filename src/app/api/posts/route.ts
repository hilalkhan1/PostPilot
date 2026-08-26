import { NextResponse, type NextRequest } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
  mediaAssets,
  postTargets,
  posts,
  socialAccounts,
  type Platform,
} from "@/db/schema";
import { validateForPlatform } from "@/adapters/validate";
import type { ResolvedContent } from "@/adapters/types";
import { getSession } from "@/lib/auth";
import { runTick } from "@/lib/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CreatePost = z.object({
  text: z.string().default(""),
  mediaIds: z.array(z.string().uuid()).default([]),
  link: z.string().url().optional(),
  accountIds: z.array(z.string().uuid()).min(1, "Pick at least one account."),
  /** ISO local time, e.g. "2026-09-01T09:00". Absent means publish now. */
  scheduledAt: z.string().optional(),
  timezone: z.string().default("UTC"),
  overrides: z
    .record(
      z.string(),
      z.object({
        text: z.string().optional(),
        firstComment: z.string().optional(),
      }),
    )
    .default({}),
});

export async function GET() {
  const session = await getSession();

  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.orgId, session.orgId))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  if (rows.length === 0) return NextResponse.json({ posts: [] });

  const targets = await db
    .select()
    .from(postTargets)
    .where(
      inArray(
        postTargets.postId,
        rows.map((p) => p.id),
      ),
    );

  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.orgId, session.orgId));

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return NextResponse.json({
    posts: rows.map((post) => ({
      ...post,
      targets: targets
        .filter((t) => t.postId === post.id)
        .map((t) => ({
          ...t,
          account: accountById.get(t.socialAccountId) ?? null,
        })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  const parsed = CreatePost.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  /* ---- resolve the chosen destinations ---- */
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(inArray(socialAccounts.id, input.accountIds));

  const mine = accounts.filter((a) => a.orgId === session.orgId);
  if (mine.length !== input.accountIds.length) {
    return NextResponse.json(
      { error: "One of those accounts is not connected to this workspace." },
      { status: 403 },
    );
  }

  /* ---- resolve media once, reuse for every platform's validation ---- */
  const assets =
    input.mediaIds.length > 0
      ? await db
          .select()
          .from(mediaAssets)
          .where(inArray(mediaAssets.id, input.mediaIds))
      : [];

  const byId = new Map(assets.map((a) => [a.id, a]));
  const orderedMedia = input.mediaIds
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      id: a.id,
      publicUrl: a.publicUrl,
      mime: a.mime,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      altText: a.altText,
    }));

  const contentFor = (platform: Platform): ResolvedContent => ({
    text: input.overrides[platform]?.text ?? input.text,
    media: orderedMedia,
    link: input.link,
    firstComment: input.overrides[platform]?.firstComment,
  });

  /* ---- validate before writing anything ---- *
   * The same function the composer runs. Refusing here is the difference
   * between an error the user can fix now and a failure at 3am.             */
  const blocking: string[] = [];
  for (const account of mine) {
    const check = validateForPlatform(account.platform, contentFor(account.platform));
    for (const issue of check.issues) {
      if (issue.severity === "error") {
        blocking.push(`${account.displayName}: ${issue.message}`);
      }
    }
  }

  if (blocking.length > 0) {
    return NextResponse.json({ error: blocking.join(" ") }, { status: 422 });
  }

  /* ---- work out when ---- */
  let scheduledAt = new Date();
  if (input.scheduledAt) {
    // Interpret the wall-clock time the user typed *in their zone*, then store
    // the resulting instant. Keeping the zone alongside it is what lets a
    // recurring 9am survive a DST change later.
    const local = DateTime.fromISO(input.scheduledAt, { zone: input.timezone });
    if (!local.isValid) {
      return NextResponse.json(
        { error: `That date could not be read in ${input.timezone}.` },
        { status: 400 },
      );
    }
    scheduledAt = local.toJSDate();
  }

  const publishNow = !input.scheduledAt;

  /* ---- write the post and its fan-out ---- */
  const [post] = await db
    .insert(posts)
    .values({
      orgId: session.orgId,
      createdBy: session.userId,
      status: "scheduled",
      baseContent: {
        text: input.text,
        mediaIds: input.mediaIds,
        link: input.link,
      },
      scheduledAt,
      timezone: input.timezone,
    })
    .returning();

  await db.insert(postTargets).values(
    mine.map((account) => ({
      postId: post.id,
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt,
      status: "scheduled" as const,
      overrides: {
        text: input.overrides[account.platform]?.text,
        firstComment: input.overrides[account.platform]?.firstComment,
      },
    })),
  );

  /* ---- publishing now? don't make them wait for the next tick ---- */
  let tick = null;
  if (publishNow) {
    try {
      tick = await runTick(25);
    } catch (error) {
      console.error("[posts] inline tick failed", error);
    }
  }

  return NextResponse.json({ post, publishNow, tick }, { status: 201 });
}
