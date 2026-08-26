import { capabilitiesFor } from "../capabilities";
import {
  PlatformError,
  type PlatformAdapter,
  type PublishOutcome,
} from "../types";
import { graphPost } from "./client";

type FeedResponse = { id: string };
type PhotoResponse = { id: string; post_id?: string };

/**
 * Facebook Pages are the simple one: a single form POST, no async processing.
 * Media is passed as a URL — Facebook fetches it itself, which is why the
 * storage bucket has to be publicly readable even in development.
 */
export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",
  provider: "meta",
  capabilities: capabilitiesFor("facebook"),

  async advance(ctx): Promise<PublishOutcome> {
    const pageId = ctx.account.platformAccountId;
    const image = ctx.content.media[0];

    try {
      let postId: string;

      if (image) {
        const { data, status } = await graphPost<PhotoResponse>(
          `/${pageId}/photos`,
          {
            url: image.publicUrl,
            caption: ctx.content.text,
            access_token: ctx.accessToken,
            ...(image.altText ? { alt_text_custom: image.altText } : {}),
          },
        );
        // `post_id` is the feed story; `id` is the photo object. Link to the story.
        postId = data.post_id ?? data.id;
        await ctx.log({
          step: "publish_photo",
          outcome: "published",
          httpStatus: status,
          requestId: postId,
        });
      } else {
        const { data, status } = await graphPost<FeedResponse>(
          `/${pageId}/feed`,
          {
            message: ctx.content.text,
            access_token: ctx.accessToken,
            ...(ctx.content.link ? { link: ctx.content.link } : {}),
          },
        );
        postId = data.id;
        await ctx.log({
          step: "publish_feed",
          outcome: "published",
          httpStatus: status,
          requestId: postId,
        });
      }

      return {
        kind: "published",
        remotePostId: postId,
        permalink: `https://www.facebook.com/${postId}`,
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
