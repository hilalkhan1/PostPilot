import { capabilitiesFor } from "../capabilities";
import {
  PlatformError,
  type PlatformAdapter,
  type PublishContext,
  type PublishOutcome,
} from "../types";
import { graphFetch, graphPost, graphUrl } from "./client";

type ContainerResponse = { id: string };
type StatusResponse = {
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
};
type PublishResponse = { id: string };
type PermalinkResponse = { permalink?: string };
type LimitResponse = {
  data?: { quota_usage?: number; config?: { quota_total?: number } }[];
};

/**
 * Instagram will not tell you *why* a container failed if the daily cap is the
 * reason, so check the budget first and fail with something a human can act on.
 */
async function assertBudget(ctx: PublishContext): Promise<void> {
  const params = new URLSearchParams({
    fields: "config,quota_usage",
    access_token: ctx.accessToken,
  });

  try {
    const { data } = await graphFetch<LimitResponse>(
      `${graphUrl(`/${ctx.account.platformAccountId}/content_publishing_limit`)}?${params}`,
    );
    const row = data.data?.[0];
    const used = row?.quota_usage ?? 0;
    const total = row?.config?.quota_total ?? 50;

    if (used >= total) {
      throw new PlatformError(
        "daily_limit_reached",
        `This Instagram account has used all ${total} of its posts for the last 24 hours. The post will go out once the window rolls forward.`,
        true, // genuinely worth retrying — just not for a while
      );
    }
  } catch (error) {
    // A failed budget check must not block publishing; only a real "full"
    // verdict should stop us.
    if (error instanceof PlatformError && error.code === "daily_limit_reached") {
      throw error;
    }
  }
}

/** Create the container (or containers, for a carousel) and return its id. */
async function createContainer(ctx: PublishContext): Promise<string> {
  const igUser = ctx.account.platformAccountId;
  const media = ctx.content.media;

  if (media.length === 1) {
    const { data } = await graphPost<ContainerResponse>(`/${igUser}/media`, {
      image_url: media[0].publicUrl,
      caption: ctx.content.text,
      access_token: ctx.accessToken,
      ...(media[0].altText ? { alt_text: media[0].altText } : {}),
    });
    return data.id;
  }

  // Carousel: each child is its own container, then a parent ties them together.
  const childIds: string[] = [];
  for (const asset of media) {
    const { data } = await graphPost<ContainerResponse>(`/${igUser}/media`, {
      image_url: asset.publicUrl,
      is_carousel_item: "true",
      access_token: ctx.accessToken,
      ...(asset.altText ? { alt_text: asset.altText } : {}),
    });
    childIds.push(data.id);
  }

  const { data: parent } = await graphPost<ContainerResponse>(
    `/${igUser}/media`,
    {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: ctx.content.text,
      access_token: ctx.accessToken,
    },
  );
  return parent.id;
}

async function fetchPermalink(
  ctx: PublishContext,
  mediaId: string,
): Promise<string> {
  try {
    const params = new URLSearchParams({
      fields: "permalink",
      access_token: ctx.accessToken,
    });
    const { data } = await graphFetch<PermalinkResponse>(
      `${graphUrl(`/${mediaId}`)}?${params}`,
    );
    if (data.permalink) return data.permalink;
  } catch {
    /* a missing permalink is cosmetic — the post is already live */
  }
  return `https://www.instagram.com/p/${mediaId}`;
}

/**
 * The asynchronous one, and the reason the dispatcher is built around
 * one-step-per-tick.
 *
 *   tick N    create the container, store its id, return `pending`
 *   tick N+1  poll status_code; still IN_PROGRESS → `pending` again
 *   tick N+2  FINISHED → media_publish → `published`
 *
 * Because the container id is persisted before the next tick runs, a function
 * that dies mid-flight resumes the poll instead of creating a second post.
 */
export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",
  provider: "meta",
  capabilities: capabilitiesFor("instagram"),

  async advance(ctx): Promise<PublishOutcome> {
    const igUser = ctx.account.platformAccountId;

    try {
      /* ---- Step 1: nothing in flight yet ---- */
      if (!ctx.target.remoteContainerId) {
        if (ctx.content.media.length === 0) {
          return {
            kind: "failed",
            code: "media_required",
            message: "Instagram posts need at least one image.",
            retryable: false,
          };
        }

        await assertBudget(ctx);
        const containerId = await createContainer(ctx);

        await ctx.log({
          step: "create_container",
          outcome: "pending",
          requestId: containerId,
        });

        // Hand the id back immediately. The dispatcher persists it before the
        // next tick, which is what makes this whole flow safe to interrupt.
        return { kind: "pending", remoteContainerId: containerId };
      }

      /* ---- Step 2: something is in flight — how is it doing? ---- */
      const containerId = ctx.target.remoteContainerId;
      const params = new URLSearchParams({
        fields: "status_code,status",
        access_token: ctx.accessToken,
      });
      const { data: state } = await graphFetch<StatusResponse>(
        `${graphUrl(`/${containerId}`)}?${params}`,
      );

      if (state.status_code === "IN_PROGRESS") {
        await ctx.log({
          step: "poll_container",
          outcome: "pending",
          requestId: containerId,
        });
        return { kind: "pending", remoteContainerId: containerId };
      }

      if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
        await ctx.log({
          step: "poll_container",
          outcome: "failed",
          requestId: containerId,
          responseBody: state.status ?? state.status_code,
        });
        return {
          kind: "failed",
          code: `container_${state.status_code.toLowerCase()}`,
          message:
            state.status_code === "EXPIRED"
              ? "Instagram discarded the upload before it was published (containers expire after 24 hours)."
              : `Instagram could not process the image: ${state.status ?? "no reason given"}. The most common cause is a PNG or an aspect ratio outside 4:5 to 1.91:1.`,
          retryable: false,
        };
      }

      /* ---- Step 3: FINISHED — publish it ---- */
      const { data: published, status } = await graphPost<PublishResponse>(
        `/${igUser}/media_publish`,
        { creation_id: containerId, access_token: ctx.accessToken },
      );

      await ctx.log({
        step: "media_publish",
        outcome: "published",
        httpStatus: status,
        requestId: published.id,
      });

      return {
        kind: "published",
        remotePostId: published.id,
        permalink: await fetchPermalink(ctx, published.id),
      };
    } catch (error) {
      if (error instanceof PlatformError) {
        await ctx.log({
          step: "publish",
          outcome: "failed",
          httpStatus: error.httpStatus,
          responseBody: error.responseBody ?? error.message,
        });
        return error.toOutcome();
      }
      throw error;
    }
  },
};
