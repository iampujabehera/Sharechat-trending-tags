// Reddit free JSON endpoints — proxy for social discussion + cultural buzz.
// Reddit provides .json on every page; no auth needed for public read,
// BUT they require a non-default User-Agent or you get rate-limited / 429.
//
// Why these subreddits:
//   r/india        → broad national conversation, politics, viral moments
//   r/cricket      → cricket buzz beyond Indian-only headlines
//   r/bollywood    → film/entertainment chatter, casting buzz, releases
//
// Caveats stated honestly: Reddit-India skews English-speaking, urban, and
// male. It is NOT a proxy for tier-2/3 Hindi-belt search behaviour. We
// include it as one signal among many, not as ground truth.

interface RedditPost {
  data: {
    title?: string;
    score?: number;
    stickied?: boolean;
    over_18?: boolean;
  };
}

interface RedditListing {
  data?: { children?: RedditPost[] };
}

const FETCH_TIMEOUT_MS = 8000;
const POSTS_PER_SUB = 20;

const SUBS = {
  india: "https://www.reddit.com/r/india/hot.json",
  cricket: "https://www.reddit.com/r/cricket/hot.json",
  bollywood: "https://www.reddit.com/r/bollywood/hot.json",
} as const;

export async function fetchRedditIndia(): Promise<string[]> {
  return fetchSub(SUBS.india, "reddit_india");
}

export async function fetchRedditCricket(): Promise<string[]> {
  return fetchSub(SUBS.cricket, "reddit_cricket");
}

export async function fetchRedditBollywood(): Promise<string[]> {
  return fetchSub(SUBS.bollywood, "reddit_bollywood");
}

async function fetchSub(url: string, label: string): Promise<string[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?limit=${POSTS_PER_SUB}`, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        // Reddit will 429 you fast without a proper UA. They also explicitly
        // ask for an identifying string in the docs.
        "User-Agent":
          "Mozilla/5.0 (compatible; ShareChatTrendingBot/1.0; +https://sharechat.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[${label}] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as RedditListing;
    const posts = data.data?.children ?? [];
    const out: string[] = [];
    for (const p of posts) {
      const t = p.data?.title?.trim();
      if (!t) continue;
      // Skip stickied (mod announcements) and NSFW posts — both add noise.
      if (p.data.stickied) continue;
      if (p.data.over_18) continue;
      out.push(t);
    }
    return out.slice(0, POSTS_PER_SUB);
  } catch (e) {
    console.warn(`[${label}] fetch failed:`, e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
