import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isStorageConfigured, readImageSize, uploadMedia } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const session = await getSession();
  const assets = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.orgId, session.orgId))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(50);

  return NextResponse.json({ assets });
}

export async function POST(request: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      {
        error:
          "Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local — Facebook and Instagram fetch images from a public URL, so they cannot publish without it.",
      },
      { status: 503 },
    );
  }

  const session = await getSession();
  const form = await request.formData();
  const file = form.get("file");
  const altText = (form.get("altText") as string | null) ?? null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.` },
      { status: 413 },
    );
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only images are supported right now." },
      { status: 415 },
    );
  }

  try {
    // Dimensions are read before upload so the composer can warn about
    // Instagram's aspect ratio while the user is still looking at the screen.
    const buffer = Buffer.from(await file.slice(0, 65536).arrayBuffer());
    const size = readImageSize(buffer);

    const uploaded = await uploadMedia(session.orgId, file);

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        orgId: session.orgId,
        storageKey: uploaded.storageKey,
        publicUrl: uploaded.publicUrl,
        mime: file.type,
        bytes: uploaded.bytes,
        width: size?.width ?? null,
        height: size?.height ?? null,
        checksum: uploaded.checksum,
        altText,
      })
      .returning();

    return NextResponse.json({ asset });
  } catch (error) {
    console.error("[media] upload failed", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
