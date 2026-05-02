// NewsAPI top headlines, India-relevant. Free tier = 100 req/day, plenty
// for a 25-minute refresh cycle.
//
// IMPORTANT: NewsAPI's `country=in` parameter currently returns zero
// articles (verified 2026-05-01). We don't know if this is a free-tier
// degrade, an India-coverage drop, or a temporary outage — but the
// observable behaviour is consistent. So we route around it via
// query-based searches on /top-headlines (which IS real-time on free
// tier; /everything is 24-hour delayed and unsuitable for trending).
//
// The query set covers three angles: India broadly, Bollywood, cricket.
// This gives entertainment + sports + general breadth without the
// quota burn of cycling 5 categories.
//
// Graceful degradation: if NEWSAPI_KEY is missing OR every query fails,
// we return [] silently rather than throwing. The pipeline keeps running
// on its other 6 sources.

const QUERIES = ["India", "Bollywood", "cricket"] as const;

interface NewsApiArticle {
  title?: string | null;
  description?: string | null;
}

interface NewsApiResponse {
  status?: string;
  articles?: NewsApiArticle[];
  message?: string;
}

const FETCH_TIMEOUT_MS = 8000;

export async function fetchIndiaNews(): Promise<string[]> {
  const key = process.env.NEWSAPI_KEY;
  if (!key) {
    console.warn("[newsapi] NEWSAPI_KEY not set — skipping NewsAPI source");
    return [];
  }

  const requests = QUERIES.map((q) => fetchQuery(q, key));
  const results = await Promise.allSettled(requests);

  // Dedupe — the queries overlap (e.g. an India-cricket headline shows up
  // in both q=India and q=cricket). Same headline shouldn't double-count
  // toward "this topic appeared in newsapi" downstream.
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      for (const headline of r.value) {
        const key = headline.toLowerCase().slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(headline);
      }
    } else {
      console.warn(`[newsapi] q=${QUERIES[i]} fetch failed:`, r.reason);
    }
  }
  return out;
}

async function fetchQuery(query: string, key: string): Promise<string[]> {
  const url = `https://newsapi.org/v2/top-headlines?q=${encodeURIComponent(query)}&pageSize=20&apiKey=${encodeURIComponent(key)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      // NewsAPI rejects the default Node fetch UA on free tier.
      headers: { "User-Agent": "ShareChatTrending/1.0" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NewsAPI q=${query} HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as NewsApiResponse;
    if (data.status !== "ok") {
      throw new Error(`NewsAPI q=${query}: ${data.message ?? "unknown"}`);
    }
    return (data.articles ?? [])
      .map((a) => combineTitleDesc(a.title, a.description))
      .filter((s): s is string => Boolean(s));
  } finally {
    clearTimeout(t);
  }
}

function combineTitleDesc(title?: string | null, desc?: string | null): string | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  const d = (desc ?? "").trim();
  // Skip the trailing site-name suffix NewsAPI adds: "Headline - The Hindu".
  const cleaned = t.replace(/\s+-\s+[A-Z][\w. ]+$/, "");
  return d && d.length > 10 ? `${cleaned} — ${d.slice(0, 200)}` : cleaned;
}
