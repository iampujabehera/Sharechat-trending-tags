import { NextResponse } from "next/server";
import { getOpenAI, MODELS } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Image generation is the most expensive call in the system (DALL-E 3
// standard 1024x1024 ≈ $0.04). The image bytes are cached in-memory as
// base64 so we both (a) absorb repeat taps for free, and (b) keep working
// even after the OpenAI-hosted image URL expires (those URLs are short-
// lived). One cached entry covers the top trending tag for an hour;
// memory cost is negligible at this scale.
interface CachedPost {
  imageDataUrl: string;
  caption: string;
  expires: number;
}

const cache = new Map<string, CachedPost>();
const TTL = 60 * 60 * 1000; // 1 hour

const CAPTION_SYSTEM = `You write ShareChat-style social media captions in Hindi (Devanagari).

Rules:
- Exactly 2 short lines. Casual conversational Hindi — like a friend posting, not a journalist.
- Include 1–2 relevant emojis.
- End with the provided hashtag.
- Max 30 words total.
- Do NOT use English words unless they are brand names or universally understood (cricket, IPL, WhatsApp).
- Return ONLY the caption text. No preamble, no quotes, no markdown fences.`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag")?.trim() ?? "";
  const displayName = searchParams.get("name")?.trim() ?? tag;
  const description = searchParams.get("desc")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() ?? "other";

  if (!tag) {
    return NextResponse.json({ error: "Missing 'tag' query parameter" }, { status: 400 });
  }

  const cacheKey = tag.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({
      imageDataUrl: cached.imageDataUrl,
      caption: cached.caption,
      generatedAt: new Date(cached.expires - TTL).toISOString(),
      fromCache: true,
    });
  }

  let imageDataUrl: string;
  let caption: string;

  try {
    const client = getOpenAI();

    // ---- Image generation ----
    const imageRes = await client.images.generate({
      model: "dall-e-3",
      prompt: buildImagePrompt(displayName, description, category),
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = imageRes.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image data");
    imageDataUrl = `data:image/png;base64,${b64}`;

    // ---- Caption generation ----
    const captionUserMsg = `Hashtag: ${tag}
Trend name: ${displayName}
Context: ${description || "(no extra context)"}

Write the 2-line Hindi caption now.`;

    const captionRes = await client.chat.completions.create({
      model: MODELS.summary,
      max_tokens: 200,
      messages: [
        { role: "system", content: CAPTION_SYSTEM },
        { role: "user", content: captionUserMsg },
      ],
    });

    caption = captionRes.choices[0]?.message?.content?.trim() ?? "";
    if (!caption) throw new Error("OpenAI returned no caption");
  } catch (e) {
    return NextResponse.json(
      {
        error: "Post generation failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  cache.set(cacheKey, {
    imageDataUrl,
    caption,
    expires: Date.now() + TTL,
  });

  return NextResponse.json({
    imageDataUrl,
    caption,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  });
}

// Category-aware visual cues. DALL-E 3 reliably refuses to depict named
// politicians/celebrities — for the politics category we steer it toward
// neutral civic imagery (no faces) so we don't get a refusal.
function buildImagePrompt(name: string, desc: string, category: string): string {
  const styleByCategory: Record<string, string> = {
    cricket: "vibrant Indian cricket stadium scene, fans cheering, blue jerseys, tricolor flags",
    entertainment: "cinematic Bollywood/regional film aesthetic, dramatic lighting, vivid colors",
    politics: "respectful neutral Indian civic scene, no specific politicians, no recognizable faces",
    weather: "atmospheric Indian street scene reflecting the weather conditions in the topic",
    festival: "traditional Indian festival imagery — diyas, rangoli, warm celebratory lighting",
    finance: "Indian market or shop scene, newspaper or rupee notes on table, modest tone",
    tech: "modern Indian tech-professional setting, smartphones, contemporary urban India",
    other: "authentic Indian everyday scene relevant to the topic",
  };

  const styleHint = styleByCategory[category] ?? styleByCategory.other;

  return `An authentic Indian social-media post photograph about: ${name}.
Mobile-photography aesthetic, candid, vibrant, real-feeling moment.
Style cues: ${styleHint}.
Context: ${desc}.
Composition: square, natural lighting, India-specific visual cues.
Strictly NO text, NO captions, NO watermarks, NO logos in the image.`;
}
