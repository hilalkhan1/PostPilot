import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Media storage.
 *
 * This is not a convenience layer. Meta fetches images from a public URL rather
 * than accepting an upload, so a `localhost` path fails even in development —
 * uploads have to land somewhere publicly reachable from the very first run.
 */

function client() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local — Instagram and Facebook cannot publish images without a public URL.",
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export function isStorageConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export type UploadResult = {
  storageKey: string;
  publicUrl: string;
  checksum: string;
  bytes: number;
};

export async function uploadMedia(
  orgId: string,
  file: File,
): Promise<UploadResult> {
  const supabase = client();
  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.toLowerCase()
    : file.type.split("/")[1];

  // Content-addressed: re-uploading the same image is idempotent and costs
  // nothing, which matters on a 1 GB free tier.
  const storageKey = `${orgId}/${checksum.slice(0, 32)}.${extension}`;

  const { error } = await supabase.storage
    .from(env.SUPABASE_BUCKET)
    .upload(storageKey, buffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: "31536000",
    });

  if (error) {
    throw new Error(`Could not upload to Supabase Storage: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(env.SUPABASE_BUCKET)
    .getPublicUrl(storageKey);

  return {
    storageKey,
    publicUrl: data.publicUrl,
    checksum,
    bytes: buffer.byteLength,
  };
}

/**
 * Read an image's dimensions from its header bytes.
 *
 * Aspect ratio decides whether Instagram will accept a post at all, so it has
 * to be known at upload time — early enough for the composer to warn, rather
 * than at 3am when a container comes back ERROR with no explanation. Only JPEG
 * and PNG are parsed because those are the only formats the three platforms
 * accept for still images.
 */
export function readImageSize(
  buffer: Buffer,
): { width: number; height: number } | null {
  // PNG: an IHDR chunk at a fixed offset.
  if (
    buffer.length > 24 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(12) === 0x49484452
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG: walk the segment markers looking for a start-of-frame.
  if (buffer.length > 4 && buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0–SOF15, excluding the non-frame markers DHT, JPG and DAC.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }

  return null;
}
