// YouTube Data API v3 — `videos?chart=mostPopular&regionCode=IN`. Free
// quota = 10,000 units/day; this query costs 1 unit per call, so even
// querying 4 categories × 48 refreshes/day = 192 units. Comfortably free.
//
// Graceful degradation: missing key OR quota exhausted → return [].

interface YouTubeVideo {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    categoryId?: string;
  };
}

interface YouTubeListResponse {
  items?: YouTubeVideo[];
  error?: { message?: string };
}

// 0 = no category filter (overall trending). The rest are India-relevant.
const CATEGORY_IDS = [0, 17, 24, 25, 10] as const;

const FETCH_TIMEOUT_MS = 8000;

export async function fetchYouTubeTrending(): Promise<string[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.warn("[youtube] YOUTUBE_API_KEY not set — skipping YouTube source");
    return [];
  }

  const requests = CATEGORY_IDS.map((id) => fetchCategory(id, key));
  const results = await Promise.allSettled(requests);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("[youtube] category fetch failed:", r.reason);
      continue;
    }
    for (const title of r.value) {
      if (seen.has(title)) continue;
      seen.add(title);
      out.push(title);
    }
  }
  return out;
}

async function fetchCategory(categoryId: number, key: string): Promise<string[]> {
  const params = new URLSearchParams({
    part: "snippet",
    chart: "mostPopular",
    regionCode: "IN",
    maxResults: "20",
    hl: "hi",
    key,
  });
  if (categoryId > 0) params.set("videoCategoryId", String(categoryId));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
      { signal: ctrl.signal, cache: "no-store" }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as YouTubeListResponse;
    if (data.error) throw new Error(data.error.message ?? "YouTube API error");

    return (data.items ?? [])
      .map((v) => {
        const title = v.snippet?.title?.trim();
        const channel = v.snippet?.channelTitle?.trim();
        if (!title) return null;
        return channel ? `${title} (channel: ${channel})` : title;
      })
      .filter((s): s is string => Boolean(s));
  } finally {
    clearTimeout(t);
  }
}
