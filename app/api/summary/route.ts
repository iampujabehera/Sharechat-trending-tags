import { NextResponse } from "next/server";
import { getOpenAI, MODELS } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory summary cache, keyed by tag. Summaries don't change minute-
// to-minute, and the same trend will be tapped many times — so we cache
// for the same 25 minutes as the main feed.
const cache = new Map<string, { text: string; expires: number }>();
const TTL = 25 * 60 * 1000;

const SYSTEM_PROMPT = `You are writing for ShareChat users — Hindi-speaking people from tier 2/3 cities in India.

Write exactly 2 sentences in Hindi (Devanagari) explaining:
1. What is happening with this trend right now
2. Why people in India are talking about it

Write naturally, as if explaining to a friend. Not formal. Not journalistic. Use simple Hindi that anyone can understand.

Return ONLY the 2 sentences. Nothing else. No preamble. No labels. No markdown fences. No English unless it's a brand or proper noun.`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag")?.trim() ?? "";
  const displayName = searchParams.get("name")?.trim() ?? tag;
  const description = searchParams.get("desc")?.trim() ?? "";

  if (!tag) {
    return NextResponse.json({ error: "Missing 'tag' query parameter" }, { status: 400 });
  }

  const cacheKey = `${tag}::${displayName}::${description}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({
      summary: cached.text,
      generatedAt: new Date(cached.expires - TTL).toISOString(),
      fromCache: true,
    });
  }

  const userMessage = `Trending topic: ${displayName} (${tag})
Brief description: ${description || "(no extra description provided)"}

Write the 2 Hindi sentences now.`;

  let summary: string;
  try {
    const client = getOpenAI();
    const response = await client.chat.completions.create({
      model: MODELS.summary,
      max_tokens: 400, // 2 Hindi sentences ≈ ~150 tokens; 400 is generous headroom
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("OpenAI returned no text");
    summary = text;
  } catch (e) {
    return NextResponse.json(
      {
        error: "Summary generation failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  cache.set(cacheKey, { text: summary, expires: Date.now() + TTL });

  return NextResponse.json(
    {
      summary,
      generatedAt: new Date().toISOString(),
      fromCache: false,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
      },
    }
  );
}
