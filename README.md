# ShareChat Trending Tags System

A Next.js 14 prototype that auto-discovers what's trending in India today and renders it in a ShareChat-styled mobile UI. Built as a ShareChat APM assignment by Puja Behera.

**Live demo:** _add Vercel URL after deploy_
**Stack:** Next.js 14 · TypeScript · Tailwind · OpenAI API (`gpt-4o-mini` for both extraction and summaries, with the SDK's automatic 429/5xx retry) · Vercel

---

## How the system decides what's trending

### Why this signal mix — the proxy disclosure

The assignment asks for "what people are searching for, what's spiking in posts and views, what's breaking in the news, what's going viral on other platforms." The honest constraint: we cannot access ShareChat's internal data, X/Twitter's API is paid, and Instagram's is closed. So this prototype approximates each of those signal types with the best free public proxy available:

| Assignment signal | Free proxy used here |
|---|---|
| What people are **searching for** | **Google Trends India** RSS — direct search-intent feed |
| What's **going viral** on other platforms | **YouTube Trending India** — viral video chart |
| What's a **social spike** / cultural buzz | **Reddit** r/india + r/cricket + r/bollywood (English-skewed but useful discussion signal) |
| What's **breaking in the news** | **NewsAPI** + 5 Indian RSS feeds |
| Cultural / festival context | Local cultural calendar JSON |

This is explicitly a proxy-based stack. It is NOT a substitute for ShareChat-internal post velocity, view counts, or in-app search — those would replace several of these proxies in production. The goal here is to demonstrate the pipeline shape end-to-end, with honest sources we can actually access.

### Signal sources, in detail

| Source                    | Signal type            | Why it's in the mix                                                                                   | Failure mode                                              |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Google Trends India**   | Search intent          | RSS feed of rising searches in India. Closest free proxy to "what users are typing into a search box right now". | No auth; degrades to `[]` on network/parse failure.       |
| **YouTube Trending IN**   | Viral / social proxy   | Most-popular chart across general/sports/entertainment/news/music. Surfaces virality news media misses. | Optional. Skipped if `YOUTUBE_API_KEY` missing.           |
| **Reddit r/india**        | National social discussion | English-skewed but rich on what's being argued about today.                                       | No auth (public JSON); skipped on 429/network failure.    |
| **Reddit r/cricket**      | Cricket fan buzz       | Cricket-fan discussion that's broader than match-result coverage.                                     | Same as above.                                            |
| **Reddit r/bollywood**    | Film/entertainment chatter | Casting buzz, release rumours, fan theories — buzz that beats news to the punch.                  | Same as above.                                            |
| **NewsAPI** (India-relevant) | Breaking news       | India-relevant top headlines via 3 query strings (`India`, `Bollywood`, `cricket`) on `/top-headlines`. **Note**: NewsAPI's `country=in` parameter currently returns zero articles; we route around it via query-based search. See [`lib/sources/newsapi.ts`](lib/sources/newsapi.ts) for the rationale. | Optional. Skipped if `NEWSAPI_KEY` missing.               |
| **5x RSS feeds**          | Breaking news          | NDTV, TOI, The Hindu, Gadgets360, NDTV Cricket. No auth.                                              | One feed dying ≠ all feeds dying — `Promise.allSettled`.  |
| **Cultural calendar**     | Cultural context       | Hardcoded JSON of festivals + cricket fixtures with `boostDaysBefore`. Solves the cold-start problem — Buddha Purnima matters even if NDTV hasn't written about it yet. | Local file; cannot fail unless malformed.                 |

### Pipeline Architecture

```
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────────┐
 │GoogleTrends│ │  YouTube   │ │ Reddit   │ │ Reddit   │ │ Reddit   │ │ NewsAPI  │ │  5x RSS    │ │ Cultural calendar│
 │  IN (RSS)  │ │ Trending IN│ │ r/india  │ │r/cricket │ │r/bolly   │ │  India   │ │  feeds     │ │ (static JSON)    │
 └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ └────────┬─────────┘
       │              │             │            │            │            │             │                 │
       │ search       │ viral       │ social     │ cricket    │ film       │ breaking    │ breaking        │
       │ intent       │ proxy       │ disc.      │ buzz       │ chatter    │ news        │ news            │
       └──────────────┴─────────────┴────────────┴────────────┴────────────┴─────────────┘                 │
                                                ▼                                                          │
                                        ┌───────────────┐                                                  │
                                        │   INGEST      │                                                  │
                                        │ Promise.all-  │                                                  │
                                        │ Settled,      │                                                  │
                                        │ 8s timeouts   │                                                  │
                                        └───────┬───────┘                                                  │
                               ▼                              │
                       ┌───────────────┐                      │
                       │   EXTRACT     │                      │
                       │ OpenAI        │                      │
                       │ gpt-4o-mini   │                      │
                       │  → ExtractedTopic[]                  │
                       └───────┬───────┘                      │
                               ▼                              │
                       ┌───────────────┐                      │
                       │   CLUSTER     │                      │
                       │ Dedupe by     │                      │
                       │ normalized    │                      │
                       │ tag, merge    │                      │
                       │ sources.      │                      │
                       └───────┬───────┘                      │
                               ▼                              │
                       ┌───────────────┐ ◄────────────────────┐
                       │   SCORE       │  (calendar is a       │
                       │ heatScore =   │   mild 10% tiebreaker │
                       │ 0.30·sourceCt │   inside trending,    │
                       │ + 0.25·rel    │   not a dominator)    │
                       │ + 0.35·vel    │                       │
                       │ + 0.10·cal    │                       │
                       └───────┬───────┘                       │
                               ▼                               │
                  ┌────────────────────────┐                   │
                  │  SPLIT into two strips │                   │
                  ├────────────────────────┤                   │
                  │  tags  (max 15)        │                   │
                  │  → news/social driven  │                   │
                  ├────────────────────────┤                   │
                  │  today (max 5)  ◄──────┼───────────────────┘
                  │  → calendar-only,      │   (festivals/civic days
                  │    by date proximity   │    that haven't hit
                  │                        │    news yet)
                  └────────────┬───────────┘
                               ▼
                       ┌───────────────┐
                       │  JSON to UI   │
                       │  → 2 strips   │
                       └───────────────┘
```

### Scoring Formula

```
heatScore = (sourceScore   × 0.30)   ← weighted-sum of sources, NOT raw count
          + (relevanceScore × 0.25)   ← GPT's India-relevance verdict
          + (velocityScore × 0.35)    ← signal-type diversity (search + viral + social + news)
          + (calendarScore × 0.10)    ← festival/cricket proximity boost
```

**Sources are NOT counted equally.** Each source has a weight reflecting what it uniquely captures (defined in [`lib/pipeline/score.ts`](lib/pipeline/score.ts) `SOURCE_WEIGHTS`):

| Source | Weight | Why this weight |
|---|---|---|
| `google_trends` | 1.3 | Direct user search intent — strongest single signal of what people want right now |
| `youtube` | 1.1 | Viral video proxy — second-strongest because it shows actual cultural traction |
| `reddit_*` (any) | 0.9 | Social discussion — useful but English-skewed and not the target audience |
| `newsapi` / `rss` | 0.8 | Breaking news — always present, lower marginal info per source |

`sourceScore = min(100, (Σ weights) / 3.0 × 100)`. So a topic showing up in `google_trends` + `youtube` + `reddit_cricket` (1.3 + 1.1 + 0.9 = 3.3) saturates the bar; a topic only in `newsapi` + `rss` (0.8 + 0.8 = 1.6) gets ~53.

**Velocity scoring** rewards signal-type diversity, not just source count:

- `+20` if the topic appears in `google_trends` (active demand)
- `+15` if it appears in `youtube` (crossing into viral)
- `+10` if it appears in any reddit (people discussing it)
- `+5` if news has caught up
- `+5` more if 4+ distinct sources confirm it

So a topic in only NewsAPI + RSS = 50+5 = 55 (slow burn). A topic in Google Trends + YouTube + Reddit + RSS = 50+20+15+10+5+5 = 100 (genuinely trending).

In plain English:

- **Source count (30%)** — Weighted-sum so search-intent and viral signals contribute more than news. This is the anti-manipulation + signal-quality lever.
- **India relevance (25%)** — The model's per-topic 0–1 score. The prompt tells it to score Hindi-belt + tier-2/3 cities, not metro English India. "RBI Rate Cut" passes; "Federal Reserve" fails.
- **Velocity (35%)** — Proxy for spread speed using signal-type diversity. Real velocity (time-bucketed counts) is Day-2 work and called out in the Honest Gaps section.
- **Cultural calendar boost (10%)** — A mild tiebreaker inside the trending leaderboard. If a topic Gemini extracted (e.g. "बंगाल चुनाव") happens to coincide with a calendar event, it gets a small lift. Calendar-only events (festivals nobody is reporting on yet) do **not** appear in the trending leaderboard — they live in a separate "आज का दिन" strip. This is an explicit editorial choice: see the [Two-strips editorial decision](#two-strips-editorial-decision) section below.

### Stage-by-stage breakdown

| Stage    | Tech                          | Why this choice                                                                  |
| -------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Ingest   | `Promise.allSettled`, 8s timeouts, `rss-parser` | Need parallel + per-source isolation. One bad feed must never 502 the whole API. |
| Extract  | OpenAI `gpt-4o-mini`          | Cheapest current OpenAI model with solid Hindi extraction quality. ~$0.005 per extraction call (≈ 700 calls per $5 of credit). Reliable JSON output via the chat completions API. |
| Cluster  | In-process normalization      | Belt-and-suspenders — the model already merges, but we do a deterministic dedupe by stripped-tag key as a safety net. |
| Score    | Pure-function formula in TS   | Not an LLM job — once the topics are extracted, scoring is deterministic and auditable. |
| Summary  | OpenAI `gpt-4o-mini`          | One call per detail-view tap. Same model as extraction so we maintain a consistent voice across the pipeline. The 25-min summary cache absorbs the per-tap cost. |

The runtime resilience layer is the **OpenAI SDK's built-in retry**: 429/5xx errors are auto-retried with exponential backoff (`max_retries=2` by default). We do NOT need the model-fallback chain we had with Gemini — OpenAI's reliability profile is fundamentally different. Implementation in [`lib/openai.ts`](lib/openai.ts) and [`lib/pipeline/extract.ts`](lib/pipeline/extract.ts).

> **Migration note:** the project was originally built with Google Gemini Flash. We migrated through Anthropic Claude (paid, very high quality, but $20 minimum top-up) and finally to OpenAI's `gpt-4o-mini` (paid, $5 minimum, ~5× cheaper than Claude Opus). Gemini's free tier is hard to size around for a development workflow that hits the API every 25 minutes; the paid alternatives remove quota concerns. Hindi quality on `gpt-4o-mini` is noticeably better than Gemini Flash on this prompt and within striking distance of Claude Opus.

---

## Hook-style description prompt — the actual product spec

The single highest-leverage change in this codebase is the extraction prompt in [`lib/pipeline/extract.ts`](lib/pipeline/extract.ts). The model returns a JSON array; the only field that matters for whether a tier-2/3 user taps is `description`.

The default an LLM produces is summary copy — "इस विषय के बारे में पूरी जानकारी पढ़ें", "यह विषय सोशल मीडिया पर ट्रेंड कर रहा है". That language closes the curiosity loop instead of opening it. The user reads it and concludes there is nothing left to discover. They scroll past.

So the prompt is opinionated. It bans templated phrasing (`जानिए / देखें / पढ़ें`), demands 8–16 word lines, and few-shots both good and bad examples directly inside the prompt. Few-shot is the most reliable lever for forcing curiosity-driven copy out of any LLM — and the prompt was originally hardened against Gemini Flash's strong generic-summary tendency, so it transferred to GPT with no edits.

**Editorial rule:** every description must be a hook. It must hint at the story, not summarise it. "एक छोटी सी बात, और इंटरनेट अटक गया" is the ideal shape. "पूरे देश में लोग मना रहे हैं" is the banned shape. The prompt enforces this with explicit good/bad lists.

This is also why the calendar template in [`app/api/trending/route.ts`](app/api/trending/route.ts) was rewritten — the old "पूरे देश में लोग मना रहे हैं" template was both factually wrong for regional events (Maharashtra Day, Onam) and hook-dead.

---

## Two-strips editorial decision

The original design ranked calendar events and news events in a single sorted list. Calendar boosts pushed festivals to scores of 90 even with zero news corroboration, while a 2-source news event would rank lower. This was wrong twice:

1. **Mathematically** — a festival with no signal density does not have the same nature as a 3-source-corroborated news event. They belong on different axes.
2. **Editorially** — "trending" means rising right now; calendar is predictable, not trending. Mixing them confuses both lanes.

So the API now returns two arrays:

- `tags[]` — trending leaderboard, news/social signal driven, ranked by `heatScore`. Calendar contributes 10% as a mild tiebreaker only.
- `today[]` — "आज का दिन" strip, calendar-only, ordered by date proximity. Surfaces festivals that haven't hit the news yet but matter today.

The UI renders them as visually distinct strips — the today strip is a horizontal chip carousel with no rank numbers and no heat scores; the trending strip is the vertical ranked list with full heat metrics. Different lane, different read.

---

## Hook model overlay — why the detail page is shaped this way

The trend detail overlay deliberately follows Nir Eyal's variable-reward triad — tribe / hunt / self — rather than a Wikipedia "summary + sources" layout:

- **🌍 लोग क्या कह रहे हैं (Tribe)** — what other Indians are saying about this. Sample reactions, post counts, regional skew. The reward is social: "you are part of a conversation".
- **🎬 अंदर क्या मिलेगा (Hunt)** — three teaser cards for the content the user will discover by tapping in. The reward is informational: "tap, find, satisfy curiosity".
- **💫 आपके लिए क्यों (Self)** — a one-line personal angle keyed to the user's mood/identity ("अगर आप वो हैं जो match miss नहीं करते..."). The reward is identity: "this thread is for someone like me".

The AI summary and signal-source list are intentionally demoted below these three panels, because evaluators don't tap into trends to read sources — they tap to feel a reward.

**Investment loop status: minimal.** A "+ Follow" toggle exists on the detail sheet so the prototype demonstrates the fourth Hook stage, but the toggle currently just flips local state. A real investment loop (followed-tags strip on home, push when a followed tag re-ignites, streaks on consecutive daily checks) is intentionally out of scope and called out below.

---

## Honest gaps — what this build does NOT do

These are the choices made under the 10–14 hour assignment budget. Each is a deliberate exclusion, not an oversight.

### 1. No geo-within-India layer
The cultural calendar JSON has a `relevantRegions: ["Bihar", "UP"] | ["all"]` field, but the runtime does not filter or weight by it. Result: a tier-2 Bihari user sees Maharashtra Day and Bengal Election content with the same prominence as a Maharashtrian user. The fix is two-fold — (a) accept a `region` query param or derive from IP, (b) demote `relevantRegions` mismatches in heat scoring. Day-2.

### 2. No freshness decay function
The system fetches every 25 minutes and treats all signals from one fetch as equally fresh. A 6-hour-old RSS item ranks the same as a 6-minute-old one. A real implementation would attach per-item ingest timestamps and weight by `e^(-Δt/τ)` with `τ ≈ 4–6 hours`. Without this, slow-burn topics outrank the actually-spiking ones in some windows. Day-2.

### 3. No real investment loop
The follow toggle is local-state-only. There is no follow graph, no "your trends" rail on home, no notification when a followed trend re-ignites, no streak counter. The Hook framework's investment stage is the loop that compounds retention; without it, trending tags are a vending machine, not a habit. This is the single biggest "what I'd build next" item.

### 4. No anti-manipulation per-publisher cap
Every source is one vote. A coordinated stuffing attack — multiple related headlines from one publisher across NewsAPI — would inflate a topic's source diversity score without genuine spread. Tracking `(source, publisher)` pairs and capping votes-per-publisher would harden against this. Not a problem at prototype scale; would be a problem at production.

### 5. The mock discovery copy in detail overlay
The tribe/hunt/self panels render hard-coded category-keyed copy (see `buildDiscoveryCopy` in [`components/TrendDetailOverlay.tsx`](components/TrendDetailOverlay.tsx)), not real reactions or real post teasers. The prototype is honest about this — it demonstrates the UX shape and the editorial intent. Production wiring would call:
- `/api/tag/{id}/reactions` → top comments + reaction counts
- `/api/tag/{id}/posts` → 3 best posts by engagement
- A personalisation service for the self panel

### 6. The heat-score tradeoff
Velocity is proxied by source diversity, not actual time-bucketed counts (see [`lib/pipeline/score.ts`](lib/pipeline/score.ts) `calculateVelocity`). This means a topic that quietly persists across all 3 sources gets the same velocity score as one that doubled in the last 30 minutes. The honest version requires a rolling window store (Redis or even a flat file) tracking topic counts at 30/60/120-min intervals. The proxy is good enough for a 10-hour build; real production needs the real version.

---

## UX Rationale

**Cards, not a list.** Each card stands alone — emoji avatar, Hindi name, English hashtag, single-line description, source pills, heat bar + score. The format is scannable and matches the rest of the ShareChat feed shape, so the trending screen feels native, not like a sidebar.

**Heat bar AND a number.** A bar alone is harder to compare across rows; a number alone has no relative scale on a phone. Showing both lets users feel the gap between #2 (87) and #5 (62) without doing math. Color-grades from orange→gold; matches the brand palette.

**Hindi-first content, English hashtags.** The displayName, description, and category labels are all in Devanagari. The `tag` stays in ASCII because that's how hashtags work on Twitter/Instagram — users *recognize* `#TeamIndia` even if their feed is otherwise Hindi-only.

**Slide-up detail overlay, not a new route.** Detail is a transient action, not a destination. A bottom-sheet keeps the user's mental position in the feed and lets them dismiss with a swipe. Browser back is intentionally no-op here so users don't accidentally lose their place.

**Skeleton with Hindi loading copy.** "आज के trends ढूंढ रहे हैं... 🔍" is 3 words but it does two jobs: (1) confirms the action is in flight, (2) signals that the product speaks the user's language even at the loading state, not just in the data.

**Considered and rejected:**
- _A horizontally scrolling rail of trends._ Optimizes the wrong thing — phone scroll is vertical; users would miss everything past the first 3.
- _Auto-refresh every 30s._ Would jank the scroll. Manual refresh button is fine; cache TTL is 25 min.
- _Showing the raw indiaRelevanceScore (0.0–1.0)._ Decimal scoring reads like data-team output, not a consumer product. Heat score 0–100 reads as "how hot is it."

---

## What I'd build next (4 more weeks)

1. **Region-aware trending.** The cultural calendar already has `relevantRegions`. Wire it through to the heat formula so a Bihar/UP user sees Chhath Puja boosted and a Kerala user sees Onam. Server-side region detection from IP + an opt-in override toggle.
2. **Multi-language displayName, not just Hindi.** Bengali, Tamil, Telugu, Marathi. Same pipeline; add a `language` query param and have GPT translate the displayName + description in one extra step. ShareChat is vernacular-first — Hindi alone undersells this.
3. **Trend velocity from time-bucketed counts.** Currently we proxy velocity via source diversity. With a Redis or even just a rolling-file store of "topic X count over last 30/60/120 min," we'd get real velocity. Topics that doubled their count in the last 30 min would clearly outrank evergreen mentions.
4. **Anti-manipulation v2: per-source weight.** Right now every source is one vote. A coordinated NewsAPI stuffing attack (lots of related headlines from one publisher) could spike heatScore. Tracking `(source, publisher)` pairs and capping votes-per-publisher would harden against this.
5. **"Why is this trending?" inline in the card.** The AI summary lives in the detail overlay today. A 1-line, 8-token caption ("क्योंकि भारत-ऑस्ट्रेलिया मैच आज है") on each card itself, generated in the same extraction call (one extra field), would be the single highest-impact UX upgrade — users wouldn't need to tap to understand.

---

## Tools used

- **Claude Code** — to scaffold the project, write source modules, prompt design, UI components.
- **OpenAI API** (`gpt-4o-mini`) — extraction + summaries via the official `openai` Node SDK.
- **Next.js 14 App Router** — served the SSR-shell + API routes from one repo.
- **Tailwind CSS** — design tokens kept colocated with components.
- **rss-parser**, **fast `fetch`** — ingest layer, no extra middleware needed.

---

## Setup

```bash
# 1. install
npm install

# 2. configure env
cp .env.example .env.local
# fill in OPENAI_API_KEY (required — get from https://platform.openai.com/api-keys),
# NEWSAPI_KEY + YOUTUBE_API_KEY (optional)

# 3. run
npm run dev
# → http://localhost:3000  (UI)
# → http://localhost:3000/api/trending  (raw JSON)
# → http://localhost:3000/api/trending?refresh=1  (bust the 25-min cache)
```

### Deploying to Vercel

```bash
npm install -g vercel
vercel
# add env vars in dashboard: OPENAI_API_KEY (req), NEWSAPI_KEY, YOUTUBE_API_KEY
```

Vercel auto-detects Next.js. The Node runtime is set explicitly on both API routes (Edge runtime is incompatible with `rss-parser`).

### API contract — quick reference

`GET /api/trending` → `TrendingResponse`
`GET /api/trending?refresh=1` → bypasses in-memory cache
`GET /api/summary?tag=...&name=...&desc=...` → `{ summary, generatedAt, fromCache }`

`TrendingResponse` shape:

```ts
{
  tags: TrendingTag[],         // trending strip — news/social driven
  today?: TrendingTag[],       // optional "आज का दिन" strip — calendar driven
  fetchedAt: "2026-05-01T07:24:46.244Z",
  totalSources: 2,             // count of sources that returned at least one signal
  fromCache: false,
  errors?: { source, message }[],  // dev diagnostics, safe to ignore in UI
}
```

`TrendingTag` shape:

```ts
{
  id: "ipl-2026",
  tag: "#IPL2026",
  displayName: "IPL का रोमांच",
  description: "एक over और match का रंग बदल गया",  // hooky one-liner, 8–16 words
  category: "cricket",                              // 8 enum values
  heatScore: 92,                                    // 0–100
  sources: ["rss", "youtube"],                      // newsapi | rss | youtube
  sourceCount: 2,
  emoji: "🏏",
  freshness: "2026-05-01T13:42:11.000Z",
  kind?: "trending" | "today",                      // discriminator for the two strips
  aiSummary?: "..."                                 // hydrated lazily by /api/summary
}
```

### Failure handling — four layers of graceful degradation

1. **One source fails** → it's missing from `sources` arrays; the rest of the pipeline runs normally.
2. **OpenAI transient 429/5xx** → the OpenAI SDK auto-retries with exponential backoff (default `max_retries=2`). Most user requests never see this layer.
3. **All seven external sources fail OR OpenAI SDK retries exhausted** → fallback to `public/fallback-trends.json` (13 trending tags + 7 today entries, all Hindi, hook-style). User never sees a blank screen.
4. **Fallback file unreadable** → API returns 502 with `errors` array. UI shows the localized error state ("कुछ गड़बड़ हो गई").
