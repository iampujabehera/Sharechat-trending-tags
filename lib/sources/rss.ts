import Parser from "rss-parser";

// RSS feeds from major Indian publications. All free, no auth. The mix
// covers: NDTV (general), TOI (volume + breadth), The Hindu (national),
// Gadgets360 (tech/Bollywood overlap), NDTV Cricket (sports specificity).
const RSS_FEEDS: { url: string; source: string }[] = [
  { url: "https://feeds.feedburner.com/ndtvnews-top-stories", source: "NDTV" },
  { url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", source: "TOI" },
  { url: "https://www.thehindu.com/news/national/feeder/default.rss", source: "TheHindu" },
  { url: "https://feeds.feedburner.com/gadgets360-latest", source: "Gadgets360" },
  { url: "https://sports.ndtv.com/feeds/rss/cricket-news.xml", source: "NDTVCricket" },
];

const FETCH_TIMEOUT_MS = 8000;
const ITEMS_PER_FEED = 10;

// rss-parser uses node fetch internally; we wrap with our own timeout.
const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    // Some Indian publishers (TOI especially) reject the default UA.
    "User-Agent":
      "Mozilla/5.0 (compatible; ShareChatTrendingBot/1.0; +https://sharechat.com)",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  },
});

export interface RssItem {
  title: string;
  source: string;
}

export async function fetchRSSFeeds(): Promise<RssItem[]> {
  // allSettled — one feed dying must not poison the whole pipeline.
  const results = await Promise.allSettled(
    RSS_FEEDS.map((f) => fetchOne(f.url, f.source))
  );

  const out: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      console.warn(`[rss] ${RSS_FEEDS[i].source} failed:`, r.reason);
    }
  }
  return out;
}

async function fetchOne(url: string, source: string): Promise<RssItem[]> {
  const feed = await parser.parseURL(url);
  return (feed.items ?? [])
    .slice(0, ITEMS_PER_FEED)
    .map((item) => ({
      title: cleanTitle(item.title ?? ""),
      source,
    }))
    .filter((it) => it.title.length > 0);
}

function cleanTitle(t: string): string {
  return t
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
