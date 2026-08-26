/**
 * Checks the pure logic — token sealing and per-platform validation — without
 * touching the database or the network.
 *
 *   npm run smoke
 *
 * Run it after setting ENCRYPTION_KEY to confirm the key is well-formed before
 * you connect an account and discover it isn't.
 */
import { open, seal } from "../src/lib/crypto";
import { validateForPlatform } from "../src/adapters/validate";
import { escapeCommentary } from "../src/adapters/linkedin/client";
import type { ResolvedMedia } from "../src/adapters/types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function image(over: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    publicUrl: "https://example.supabase.co/storage/v1/object/public/media/a.jpg",
    mime: "image/jpeg",
    bytes: 400_000,
    width: 1080,
    height: 1080,
    altText: "A square test image",
    ...over,
  };
}

console.log("\ntoken sealing");
try {
  const secret = "AQX-fake-linkedin-access-token-value";
  const sealed = seal(secret);
  check("round-trips", open(sealed) === secret);
  check("ciphertext is not the plaintext", !sealed.includes(secret));
  check("is versioned", sealed.startsWith("v1."));
  check("is non-deterministic", seal(secret) !== seal(secret));

  // Flipping one character of the ciphertext must fail the auth tag, not
  // silently return corrupted bytes.
  const parts = sealed.split(".");
  parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
  let rejected = false;
  try {
    open(parts.join("."));
  } catch {
    rejected = true;
  }
  check("rejects tampering", rejected);
} catch (error) {
  failures++;
  console.log(`  FAIL  crypto threw — ${(error as Error).message}`);
  console.log("        Is ENCRYPTION_KEY set to 32 base64 bytes?");
}

console.log("\ninstagram validation");
{
  const ok = validateForPlatform("instagram", { text: "Hello", media: [image()] });
  check("accepts a square JPEG", ok.ok);

  const noMedia = validateForPlatform("instagram", { text: "Hello", media: [] });
  check("rejects a caption with no image", !noMedia.ok);

  const png = validateForPlatform("instagram", {
    text: "Hello",
    media: [image({ mime: "image/png" })],
  });
  check("rejects PNG", !png.ok);

  const tall = validateForPlatform("instagram", {
    text: "Hello",
    media: [image({ width: 500, height: 1500 })],
  });
  check("rejects an out-of-range aspect ratio", !tall.ok);

  const hashtags = validateForPlatform("instagram", {
    text: Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" "),
    media: [image()],
  });
  check("rejects 31 hashtags", !hashtags.ok);

  const long = validateForPlatform("instagram", {
    text: "x".repeat(2201),
    media: [image()],
  });
  check("rejects a 2,201-character caption", !long.ok);
}

console.log("\nlinkedin validation");
{
  const ok = validateForPlatform("linkedin", { text: "Hello", media: [] });
  check("accepts text with no image", ok.ok);

  const png = validateForPlatform("linkedin", {
    text: "Hello",
    media: [image({ mime: "image/png" })],
  });
  check("accepts PNG", png.ok);

  const long = validateForPlatform("linkedin", {
    text: "x".repeat(3001),
    media: [],
  });
  check("rejects a 3,001-character post", !long.ok);
}

console.log("\nfacebook validation");
{
  const two = validateForPlatform("facebook", {
    text: "Hello",
    media: [image(), image({ id: "00000000-0000-0000-0000-000000000002" })],
  });
  check("rejects a second image", !two.ok);
}

console.log("\nlinkedin commentary escaping");
{
  check(
    "escapes reserved characters",
    escapeCommentary("Costs (a lot) & [more]") ===
      "Costs \\(a lot\\) & \\[more\\]",
    escapeCommentary("Costs (a lot) & [more]"),
  );
  check(
    "leaves hashtags alone",
    escapeCommentary("Shipping #postpilot today") ===
      "Shipping #postpilot today",
  );
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
