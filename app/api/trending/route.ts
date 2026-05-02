import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  CalendarEvent,
  ExtractedTopic,
  SourceName,
  TrendingResponse,
  TrendingTag,
} from "@/lib/types";
import { fetchIndiaNews } from "@/lib/sources/newsapi";
import { fetchRSSFeeds, type RssItem } from "@/lib/sources/rss";
import { fetchYouTubeTrending } from "@/lib/sources/youtube";
import { fetchGoogleTrendsIndia } from "@/lib/sources/google-trends";
import {
  fetchRedditIndia,
  fetchRedditCricket,
  fetchRedditBollywood,
} from "@/lib/sources/reddit";
import { getUpcomingCalendarBoosts } from "@/lib/sources/calendar";
import { extractTopics, type RawInput } from "@/lib/pipeline/extract";
import { calculateHeatScore } from "@/lib/pipeline/score";
import { clusterTopics } from "@/lib/pipeline/cluster";

// Force Node runtime — rss-parser is not Edge-friendly.
export const runtime = "nodejs";
// We manage caching ourselves via the in-memory map below.
export const dynamic = "force-dynamic";

const CACHE_DURATION = 25 * 60 * 1000; // 25 minutes

// In-memory cache. Vercel serverless instances live long enough between
// invocations that this is meaningful; the first call to a cold instance
// will re-populate it.
let cache: { data: TrendingResponse; timestamp: number } | null = null;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  // Serve from cache if valid.
  if (!forceRefresh && cache && Date.now() - cache.timestamp < CACHE_DURATION) {
    return jsonResponse({ ...cache.data, fromCache: true });
  }

  const errors: { source: string; message: string }[] = [];

  // Fan out source fetches in parallel. allSettled means a single failure
  // doesn't kill the others. We run 7 sources covering 4 signal types:
  //   - search intent: google_trends
  //   - viral/social: youtube
  //   - social discussion: reddit_india + reddit_cricket + reddit_bollywood
  //   - breaking news: newsapi + rss
  // Calendar is layered on after this (local file, can't fail over network).
  const [newsRes, rssRes, ytRes, gtRes, rIndRes, rCriRes, rBolRes] =
    await Promise.allSettled([
      fetchIndiaNews(),
      fetchRSSFeeds(),
      fetchYouTubeTrending(),
      fetchGoogleTrendsIndia(),
      fetchRedditIndia(),
      fetchRedditCricket(),
      fetchRedditBollywood(),
    ]);

  const newsHeadlines = settled(newsRes, "newsapi", errors, [] as string[]);
  const rssItems = settled(rssRes, "rss", errors, [] as RssItem[]);
  const youtubeItems = settled(ytRes, "youtube", errors, [] as string[]);
  const googleTrendsItems = settled(gtRes, "google_trends", errors, [] as string[]);
  const redditIndiaItems = settled(rIndRes, "reddit_india", errors, [] as string[]);
  const redditCricketItems = settled(rCriRes, "reddit_cricket", errors, [] as string[]);
  const redditBollywoodItems = settled(rBolRes, "reddit_bollywood", errors, [] as string[]);

  // Calendar is local-file — failures here would be malformed JSON only.
  let calendarBoosts: CalendarEvent[] = [];
  try {
    calendarBoosts = getUpcomingCalendarBoosts();
  } catch (e) {
    errors.push({ source: "calendar", message: errMessage(e) });
  }

  // Count how many distinct sources actually returned signal. Each Reddit
  // sub counts as its own source — they tap different communities.
  const totalSources =
    (newsHeadlines.length > 0 ? 1 : 0) +
    (rssItems.length > 0 ? 1 : 0) +
    (youtubeItems.length > 0 ? 1 : 0) +
    (googleTrendsItems.length > 0 ? 1 : 0) +
    (redditIndiaItems.length > 0 ? 1 : 0) +
    (redditCricketItems.length > 0 ? 1 : 0) +
    (redditBollywoodItems.length > 0 ? 1 : 0);

  // If every external source is empty, drop straight to fallback. Don't
  // burn an OpenAI call on nothing.
  if (totalSources === 0) {
    console.warn("[trending] All external sources empty — serving fallback");
    return await serveFallback(errors, "All external sources empty");
  }

  const rawInput: RawInput = {
    newsapi: newsHeadlines,
    rss: rssItems,
    youtube: youtubeItems,
    google_trends: googleTrendsItems,
    reddit_india: redditIndiaItems,
    reddit_cricket: redditCricketItems,
    reddit_bollywood: redditBollywoodItems,
  };

  let extracted: ExtractedTopic[];
  try {
    const result = await extractTopics(rawInput);
    extracted = result.topics;
  } catch (e) {
    console.error("[trending] OpenAI extraction failed:", e);
    return await serveFallback(
      [...errors, { source: "openai", message: errMessage(e) }],
      "OpenAI extraction failed"
    );
  }

  // Defensive dedupe + score + sort + truncate.
  const clustered = clusterTopics(extracted);
  const freshness = new Date().toISOString();

  // Trending strip — news/social driven. Calendar is a *mild* tiebreaker
  // (10% weight inside calculateHeatScore), not a dominator. We do NOT
  // inject calendar-only events here.
  let trending: TrendingTag[] = clustered
    .map((topic) => buildTag(topic, calendarBoosts, freshness, "trending"))
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, 15);

  // "आज का दिन" strip — calendar-only, ranked by date proximity. We surface
  // the same festival even if news hasn't caught up to it yet, but it lives
  // in its own visual lane so it doesn't crowd the trending leaderboard.
  const today: TrendingTag[] = buildTodayStrip(calendarBoosts, trending, freshness);

  const response: TrendingResponse = {
    tags: trending,
    today,
    fetchedAt: freshness,
    totalSources,
    fromCache: false,
    errors: errors.length > 0 ? errors : undefined,
  };

  cache = { data: response, timestamp: Date.now() };
  return jsonResponse(response);
}

// ---- helpers -----------------------------------------------------------

function buildTag(
  topic: ExtractedTopic,
  calendarBoosts: CalendarEvent[],
  freshness: string,
  kind: "trending" | "today"
): TrendingTag {
  const heatScore = calculateHeatScore(topic, calendarBoosts);
  return {
    id: slug(topic.tag),
    tag: topic.tag,
    displayName: topic.displayName,
    description: topic.description,
    category: topic.category,
    heatScore,
    sources: topic.mentionedInSources,
    sourceCount: topic.mentionedInSources.length,
    emoji: topic.emoji,
    freshness,
    kind,
  };
}

// Build the "आज का दिन" strip: calendar-only entries for events happening
// today / very soon, ordered by date proximity. Skips events that the
// trending strip already surfaced under their own steam (e.g. if news has
// caught up to Diwali, no need to duplicate it here).
//
// We deliberately do NOT call calculateHeatScore here — calendar events
// don't have signal density. We use the boostScore directly so the UI can
// show a meter without us pretending it's the same axis as trending heat.
function buildTodayStrip(
  events: CalendarEvent[],
  trending: TrendingTag[],
  freshness: string
): TrendingTag[] {
  const out: TrendingTag[] = [];
  for (const e of events) {
    // Allow events within 14 days (boostScore decays linearly to ~0.2
    // at the edge of the window). The threshold of 0.2 is intentionally
    // generous — the strip is editorial context, not a leaderboard, so
    // a 12-day-out IPL final shouldn't be excluded just because it's
    // not imminent. Sort happens later by boostScore so today's events
    // still surface first.
    if (!e.boostScore || e.boostScore < 0.2) continue;

    const alreadyInTrending = trending.some(
      (t) =>
        t.displayName.includes(e.hindiName) ||
        t.tag.toLowerCase().includes(e.name.toLowerCase().replace(/[^a-z0-9]/gi, ""))
    );
    if (alreadyInTrending) continue;

    out.push({
      id: slug(e.name),
      tag: `#${pascalCase(e.name)}`,
      displayName: e.hindiName,
      description: descriptionForCalendarEvent(e),
      category: e.category,
      // Boost score (0.6–1.0) → display value 60–100. Same visual range
      // as heatScore but explicitly a different axis (date proximity, not
      // signal). UI labels it differently.
      heatScore: Math.round((e.boostScore ?? 0.6) * 100),
      sources: [],
      sourceCount: 0,
      emoji: e.emoji,
      freshness,
      kind: "today",
    });
  }
  // Cap the strip at 8 entries — denser than 5 so the carousel feels
  // alive, not so dense it becomes a scroll burden.
  return out.slice(0, 8);
}

// Hook-style descriptions for calendar events. We avoid the old "पूरे देश
// में लोग मना रहे हैं" template because it's both factually wrong for
// regional events (Maharashtra Day, Onam, Pongal) and hook-dead — it
// closes the curiosity loop instead of opening it.
function descriptionForCalendarEvent(e: CalendarEvent): string {
  const days = daysUntil(e.date);
  const isPanIndia = e.relevantRegions.includes("all");

  if (days === 0) {
    return isPanIndia
      ? `आज ${e.hindiName} — feed पर रंग, गाने और घर की कहानियाँ`
      : `${e.hindiName} आज — कुछ राज्यों में बड़ा दिन है`;
  }
  if (days === 1) {
    return isPanIndia
      ? `कल ${e.hindiName} — तैयारियाँ शुरू, posts आने लगीं`
      : `कल ${e.hindiName} — कौन-से राज्य आज से जुटे हैं`;
  }
  if (days >= 2 && days <= 3) {
    return `${days} दिन में ${e.hindiName} — माहौल बनना शुरू`;
  }
  if (days >= 4 && days <= 7) {
    return `${days} दिन में ${e.hindiName} — countdown शुरू`;
  }
  if (days > 7) {
    return `${days} दिन बाकी ${e.hindiName} — अभी से बातें छिड़ गईं`;
  }
  return `कल ${e.hindiName} था — आज भी posts की लहर बाकी`;
}

function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = Date.UTC(y, m - 1, d);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / (1000 * 60 * 60 * 24));
}

async function serveFallback(
  errors: { source: string; message: string }[],
  reason: string
) {
  try {
    const fallbackPath = path.join(process.cwd(), "public", "fallback-trends.json");
    const raw = await fs.readFile(fallbackPath, "utf8");
    const parsed = JSON.parse(raw) as TrendingResponse;
    return NextResponse.json(
      {
        ...parsed,
        fromCache: true,
        errors: [...errors, { source: "pipeline", message: reason }],
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
          "X-Trending-Source": "fallback",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: "All sources failed and fallback is unreadable",
        details: errMessage(e),
        upstream: errors,
      },
      { status: 502 }
    );
  }
}

function jsonResponse(data: TrendingResponse) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=1500",
    },
  });
}

function settled<T>(
  res: PromiseSettledResult<T>,
  name: SourceName,
  errors: { source: string; message: string }[],
  fallback: T
): T {
  if (res.status === "fulfilled") return res.value;
  errors.push({ source: name, message: errMessage(res.reason) });
  return fallback;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function pascalCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
