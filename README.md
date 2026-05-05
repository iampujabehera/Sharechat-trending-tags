# ShareChat Trending Tags System

A Next.js 14 prototype that auto-discovers what's trending in India today and renders it in a ShareChat-styled mobile UI. Built as a ShareChat APM assignment by Puja Behera.

**Live demo:** [sharechat-trending-tags.vercel.app](https://sharechat-trending-tags.vercel.app/)
**Walkthrough (Loom):** [2-minute video demo](https://www.loom.com/share/98e647caca2d46ff9d8d73df954f0125)
**Source:** [github.com/iampujabehera/Sharechat-trending-tags](https://github.com/iampujabehera/Sharechat-trending-tags)
**Stack:** Next.js 14 · TypeScript · Tailwind · OpenAI API (`gpt-4o-mini` + DALL-E 3) · Vercel

---

## 1. How the system decides what's trending

The brief asks for four signals: search, virality, social spike, breaking news. ShareChat's own data is closed to me, X's API is paid, Instagram's is closed. So I picked the best free proxy I could find for each signal and stitched them together.

| Assignment signal | Free proxy used here |
|---|---|
| What people are **searching for** | **Google Trends India** RSS — direct search-intent feed |
| What's **going viral** on other platforms | **YouTube Trending India** — viral video chart |
| What's a **social spike** / cultural buzz | **Reddit** r/india + r/cricket + r/bollywood |
| What's **breaking in the news** | **NewsAPI** + 5 Indian RSS feeds (NDTV, TOI, The Hindu, Gadgets360, NDTV Cricket) |
| Cultural / festival context | Local cultural calendar JSON |

These are proxies, not the real thing. In production you'd swap most of them for ShareChat's own post velocity, view counts, and search logs. The point of this build is to show the pipeline works end-to-end with sources I can actually access.

### Scoring formula

```
heatScore = (sourceScore   × 0.30)   ← weighted-sum of sources
          + (relevanceScore × 0.25)   ← GPT's India-relevance verdict (0–1)
          + (velocityScore × 0.35)    ← signal-type diversity
          + (calendarScore × 0.10)    ← festival/cricket proximity boost
```

Sources don't get equal votes. Google Trends (1.3) and YouTube (1.1) carry more weight than Reddit (0.9) or news (0.8), because someone typing a query into Google is a sharper signal of intent than a journalist filing a story. Calendar sits at 10%, just enough to break ties. I keep festivals out of the trending leaderboard on purpose; the ones that haven't hit the news yet get their own "आज का दिन" strip so they don't crowd the news and social signals.

---

## 2. Workflow diagram

```
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────────┐
 │GoogleTrends│ │  YouTube   │ │ Reddit   │ │ Reddit   │ │ Reddit   │ │ NewsAPI  │ │  5x RSS    │ │ Cultural calendar│
 │  IN (RSS)  │ │ Trending IN│ │ r/india  │ │r/cricket │ │r/bolly   │ │  India   │ │  feeds     │ │ (static JSON)    │
 └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ └────────┬─────────┘
       │ search       │ viral       │ social     │ cricket    │ film       │ breaking    │ breaking        │
       │ intent       │ proxy       │ disc.      │ buzz       │ chatter    │ news        │ news            │
       └──────────────┴─────────────┴────────────┴────────────┴────────────┴─────────────┘                 │
                                                ▼                                                          │
                                        ┌───────────────┐                                                  │
                                        │   INGEST      │  Promise.allSettled, 8s timeouts                 │
                                        └───────┬───────┘                                                  │
                                                ▼                                                          │
                                        ┌───────────────┐                                                  │
                                        │   EXTRACT     │  OpenAI gpt-4o-mini → ExtractedTopic[]           │
                                        └───────┬───────┘                                                  │
                                                ▼                                                          │
                                        ┌───────────────┐                                                  │
                                        │   CLUSTER     │  Dedupe by normalized tag, merge sources         │
                                        └───────┬───────┘                                                  │
                                                ▼                                                          │
                                        ┌───────────────┐ ◄────────────────────────────────────────────────┘
                                        │   SCORE       │  heatScore = 0.30·src + 0.25·rel + 0.35·vel + 0.10·cal
                                        └───────┬───────┘
                                                ▼
                                  ┌────────────────────────┐
                                  │  SPLIT into two strips │
                                  │  tags  (max 15)        │  → news/social driven
                                  │  today (max 5)         │  → calendar-only, by date proximity
                                  └────────────┬───────────┘
                                                ▼
                                        ┌───────────────┐
                                        │  JSON to UI   │
                                        └───────────────┘
```

---

## 3. Stage-by-stage — model, API, technique

| Stage | Tech | Why this choice |
| --- | --- | --- |
| Ingest | `Promise.allSettled`, 8s timeouts, `rss-parser` | Parallel fetch with per-source isolation. One bad feed must never 502 the API. |
| Extract | OpenAI `gpt-4o-mini` | Cheapest current OpenAI model with solid Hindi extraction. Reliable JSON output. |
| Cluster | In-process normalization | Deterministic dedupe by stripped-tag key as a safety net on top of the model's own merging. |
| Score | Pure-function formula in TS | Once topics are extracted, scoring is deterministic and auditable. Not an LLM job. |
| Summary | OpenAI `gpt-4o-mini` | One call per detail-view tap. The 25-min cache absorbs the per-tap cost. |
| Image (bonus) | OpenAI **DALL-E 3** + `gpt-4o-mini` caption | On-demand AI post (image + Hindi caption) for the #1 trending tag, only on user tap so it doesn't burn money on casual viewers. |

If OpenAI returns a 429 or 5xx, the SDK retries with backoff. If everything still fails, the route serves a static fallback file so the UI never goes blank.

---

## 4. UX rationale

The biggest UX call I made was to copy ShareChat's actual trending-tags pattern instead of inventing my own. My first version had Twitter-style cards with heat bars, source pills, and a rank chip on every row. It looked clean in isolation. But when I put it next to the real ShareChat app, mine felt like an outsider's reinterpretation. ShareChat's real trending tags are flat rows: emoji prefix, Hindi headline, subtle divider. That's it. So I rebuilt the strip to match. The richness now lives in two places where it earns its space: the hooky description on each row, and the detail overlay you get on tap.

I show heat scores only when they mean something. `🔥 87` in orange-bold for trends ≥80, muted gray for 60–79, nothing at all below 60. A 50/100 trend doesn't need a badge shouting at the user.

The content is Hindi. The structural labels (TRENDING TAGS, TODAY) stay in English uppercase, because that's what ShareChat actually does — same as Swiggy, Zomato, BookMyShow. Devanagari labels read formal and literary on a consumer surface; the English ones disappear into wayfinding, which is exactly what you want from a section header.

I split the surface into two strips on purpose. The trending leaderboard is news and social driven. The "आज का दिन" carousel above it is calendar driven (festivals, civic days). My first version mixed them into one ranked list and the calendar dominated — Buddha Purnima with zero news mentions outranking a 4-source breaking story. Different mental models, different lanes.

The detail overlay is a slide-up bottom sheet, not a new route. Tapping a trend is a transient action, not a destination; the user will be back on the feed in 20 seconds. A bottom sheet keeps their scroll position. A route would kill it.

Inside the detail overlay I borrow Nir Eyal's variable-reward triad instead of the default "summary + sources" layout: Tribe (what people are saying), Hunt (what's inside if you tap further), Self (why this is for you). Trending entries get all three. Calendar entries (Buddha Purnima, Maharashtra Day) skip Tribe and Self, because the festival itself is the identity prompt and there's no real tribe of users heatedly debating it on Reddit.

A few I considered and rejected:

- Twitter-style cards with full heat bar and source pills on every row. Felt dashboard-y. Fought the headline for attention.
- Showing the model name (`gpt-4o-mini`) under the AI summary. Reads as a debug leak. Consumer users don't care which model wrote the line.
- Engineer-source labels on the strip (`r/india`, `RSS`, `r/cricket`). Jargon to a tier-2/3 user. The detail overlay groups sources into consumer terms (खबर, वीडियो, social) instead.
- A horizontally scrolling rail of trends. Phone scroll is vertical; users would miss anything past the third trend.
- Auto-refresh every 30 seconds. Would jank the scroll. Manual pull-to-refresh, 25-min cache.
- Showing the raw `indiaRelevanceScore` (0.0–1.0). Decimal scoring reads like a data team's output, not a consumer feed.

**Honest weak spot.** The velocity score is the part I'd rebuild first. Right now I proxy it with signal-type diversity, which is good enough for a demo, but it can't tell a topic that doubled in the last 30 minutes apart from one that's been steady all day. A real Redis-backed rolling counter would fix it.

---

## 5. What I'd build next (4 more weeks)

1. **Region-aware trending.** The calendar already tags events with `relevantRegions`, but I haven't wired them into the heat formula yet. A Bihari user should see Chhath Puja boosted; a Kerala user should see Onam. IP detection with an opt-in override for travellers.
2. **Other languages, not just Hindi.** Bengali, Tamil, Telugu, Marathi. Same pipeline — add a `language` query param and let GPT translate the displayName + description on the way out. ShareChat is vernacular-first, and Hindi alone undersells that.
3. **Real velocity, not a proxy.** Replace the source-diversity hack from section 4 with a Redis-backed rolling counter. Topics that doubled in the last 30 minutes should clearly outrank evergreen mentions.
4. **Anti-manipulation: per-publisher cap.** Every source is one vote right now. A coordinated stuffing attack from one publisher could spike the score. Tracking `(source, publisher)` pairs and capping votes per publisher would harden it.
5. **"Why is this trending?" line on the card itself.** A 1-line, 8-token Hindi caption ("क्योंकि भारत-ऑस्ट्रेलिया मैच आज है") generated in the same extraction call. Highest UX leverage of anything on this list; the user wouldn't have to tap to understand.

---

## Tools used

- **Claude Code** — scaffolded the project, wrote source modules, prompts, UI components.
- **OpenAI API** (`gpt-4o-mini` + DALL-E 3) for extraction, summaries, and on-demand image generation. I started on Gemini Flash, moved to Claude for Hindi quality, then to OpenAI when the Claude bill got loud. GPT-4o-mini ended up the right balance of price and Hindi fluency for this prompt.
- **Next.js 14 App Router** · **Tailwind CSS** · **rss-parser**.

## Setup

```bash
npm install
cp .env.example .env.local      # add OPENAI_API_KEY (req), NEWSAPI_KEY + YOUTUBE_API_KEY (optional)
npm run dev                     # → http://localhost:3000
```

Deploy: `vercel` (auto-detects Next.js). Add the same env vars in the Vercel dashboard.
