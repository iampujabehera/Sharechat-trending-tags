import Parser from "rss-parser";

// Google Trends India RSS — direct search-intent signal.
// Endpoint: https://trends.google.com/trending/rss?geo=IN
// No auth, no quota, no key. Returns the day's top rising search terms.
//
// Why this source exists:
// The assignment asks for "what people are searching for". News feeds tell
// us what publishers ARE writing about; Google Trends tells us what users
// ARE actually typing into a search box right now. This is the closest
// free proxy to ShareChat-internal search trends.

const TRENDS_URL = "https://trends.google.com/trending/rss?geo=IN";
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 20;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; ShareChatTrendingBot/1.0; +https://sharechat.com)",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  },
});

export async function fetchGoogleTrendsIndia(): Promise<string[]> {
  try {
    const feed = await parser.parseURL(TRENDS_URL);
    const out: string[] = [];
    for (const item of (feed.items ?? []).slice(0, MAX_ITEMS)) {
      const title = cleanTitle(item.title ?? "");
      if (title) out.push(title);
    }
    return out;
  } catch (e) {
    console.warn("[google_trends] fetch failed:", e);
    // Don't throw — graceful degrade like every other source.
    return [];
  }
}

function cleanTitle(t: string): string {
  return t
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
