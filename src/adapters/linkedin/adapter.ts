import { capabilitiesFor } from "../capabilities";
import {
  PlatformError,
  type PlatformAdapter,
  type PublishContext,
  type PublishOutcome,
  type ResolvedMedia,
} from "../types";
import { LINKEDIN_API, escapeCommentary, linkedInFetch } from "./client";

type InitUploadResponse = {
  value: { uploadUrl: string; image: string };
};

/**
 * Upload one image and return its `urn:li:image:...` handle.
 *
 * LinkedIn is the one platform of the three that wants the actual bytes rather
 * than a URL, so the media is pulled from storage and pushed through here.
 */
async function uploadImage(
  accessToken: string,
  ownerUrn: string,
  asset: ResolvedMedia,
): Promise<string> {
  const { data: init } = await linkedInFetch<InitUploadResponse>(
    "/rest/images?action=initializeUpload",
    {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        initializeUploadRequest: { owner: ownerUrn },
      }),
    },
  );

  const source = await fetch(asset.publicUrl);
  if (!source.ok) {
    throw new PlatformError(
      "media_unreachable",
      `Could not read the image from storage (${source.status}). Check that the bucket is public.`,
      true,
    );
  }
  const bytes = await source.arrayBuffer();

  const upload = await fetch(init.value.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": asset.mime,
    },
    body: bytes,
  });

  if (!upload.ok) {
    const body = await upload.text();
    throw new PlatformError(
      "media_upload_failed",
      `LinkedIn rejected the image upload (${upload.status}).`,
      upload.status >= 500,
      false,
      upload.status,
      body.slice(0, 500),
    );
  }

  return init.value.image;
}

/** Best-effort: a failed first comment must never fail an published post. */
async function postFirstComment(
  ctx: PublishContext,
  postUrn: string,
): Promise<void> {
  try {
    await linkedInFetch(
      `/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
      {
        method: "POST",
        accessToken: ctx.accessToken,
        body: JSON.stringify({
          actor: ctx.account.platformAccountId,
          object: postUrn,
          message: { text: escapeCommentary(ctx.content.firstComment!) },
        }),
      },
    );
  } catch (error) {
    await ctx.log({
      step: "first_comment",
      outcome: "failed",
      responseBody: (error as Error).message,
    });
  }
}

export const linkedInAdapter: PlatformAdapter = {
  platform: "linkedin",
  provider: "linkedin",
  capabilities: capabilitiesFor("linkedin"),

  async advance(ctx): Promise<PublishOutcome> {
    const owner = ctx.account.platformAccountId; // urn:li:person:xxxx

    try {
      /*
       * Images are uploaded inside the same step as the post. If the post call
       * then fails retryably, the next attempt re-uploads them — a few wasted
       * megabytes, but never a duplicate post. Caching the URNs between
       * attempts is the optimisation; correctness does not depend on it.
       */
      const imageUrns: { urn: string; altText: string | null }[] = [];
      for (const asset of ctx.content.media) {
        const urn = await uploadImage(ctx.accessToken, owner, asset);
        imageUrns.push({ urn, altText: asset.altText });
      }

      if (imageUrns.length > 0) {
        await ctx.log({ step: "upload_media", outcome: "pending" });
      }

      const body: Record<string, unknown> = {
        author: owner,
        commentary: escapeCommentary(ctx.content.text),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      if (imageUrns.length === 1) {
        body.content = {
          media: {
            id: imageUrns[0].urn,
            ...(imageUrns[0].altText ? { altText: imageUrns[0].altText } : {}),
          },
        };
      } else if (imageUrns.length > 1) {
        body.content = {
          multiImage: {
            images: imageUrns.map((i) => ({
              id: i.urn,
              ...(i.altText ? { altText: i.altText } : {}),
            })),
          },
        };
      }

      const response = await linkedInFetch<unknown>("/rest/posts", {
        method: "POST",
        accessToken: ctx.accessToken,
        body: JSON.stringify(body),
      });

      // The created post's URN comes back in a header, not the body.
      const postUrn =
        response.headers.get("x-restli-id") ??
        response.headers.get("x-linkedin-id");

      if (!postUrn) {
        throw new PlatformError(
          "missing_post_id",
          "LinkedIn accepted the post but returned no id, so it cannot be linked to. Check the feed manually before retrying.",
          false,
          false,
          response.status,
          response.raw.slice(0, 500),
        );
      }

      await ctx.log({
        step: "publish",
        outcome: "published",
        httpStatus: response.status,
        requestId: postUrn,
      });

      if (ctx.content.firstComment) {
        await postFirstComment(ctx, postUrn);
      }

      return {
        kind: "published",
        remotePostId: postUrn,
        permalink: `${"https://www.linkedin.com/feed/update"}/${postUrn}/`,
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

export { LINKEDIN_API };
