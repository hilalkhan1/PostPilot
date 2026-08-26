import type { Platform } from "@/db/schema";
import type { Capabilities } from "./types";

const MB = 1024 * 1024;

/**
 * The single source of truth for what each platform will accept.
 *
 * Everything user-facing reads from here: character counters, media slots,
 * the "Instagram needs an image" warning, which override fields render at all.
 * Adding a platform should mean adding a row, not editing the composer.
 */
export const CAPABILITIES: Record<Platform, Capabilities> = {
  linkedin: {
    label: "LinkedIn",
    maxTextLength: 3000,
    maxMedia: 20,
    minMedia: 0,
    acceptedMime: ["image/jpeg", "image/png", "image/gif"],
    mediaDelivery: "upload",
    aspectRatioRange: null,
    maxImageBytes: 10 * MB,
    hashtagLimit: null,
    supportsFirstComment: true,
    supportsAltText: true,
    supportsLinkPreview: true,
    isAsync: false,
    dailyPostLimit: null,
  },

  facebook: {
    label: "Facebook Page",
    // The documented ceiling is enormous; the practical one is your reader.
    maxTextLength: 63206,
    maxMedia: 1,
    minMedia: 0,
    acceptedMime: ["image/jpeg", "image/png"],
    mediaDelivery: "public_url",
    aspectRatioRange: null,
    maxImageBytes: 25 * MB,
    hashtagLimit: null,
    supportsFirstComment: false,
    supportsAltText: true,
    supportsLinkPreview: true,
    isAsync: false,
    dailyPostLimit: null,
  },

  instagram: {
    label: "Instagram",
    maxTextLength: 2200,
    maxMedia: 10, // carousel ceiling
    minMedia: 1, // a caption alone is not a post here
    // The Content Publishing API rejects PNG for image_url. This is not a
    // conservative guess — it is the documented constraint, and the most
    // common cause of a container coming back ERROR with no useful message.
    acceptedMime: ["image/jpeg"],
    mediaDelivery: "public_url",
    aspectRatioRange: [0.8, 1.91], // 4:5 portrait through 1.91:1 landscape
    maxImageBytes: 8 * MB,
    hashtagLimit: 30,
    supportsFirstComment: true,
    supportsAltText: true,
    supportsLinkPreview: false, // links in captions are not clickable
    isAsync: true,
    dailyPostLimit: 50,
  },
};

export function capabilitiesFor(platform: Platform): Capabilities {
  return CAPABILITIES[platform];
}

export const PLATFORM_ORDER: Platform[] = ["linkedin", "facebook", "instagram"];
