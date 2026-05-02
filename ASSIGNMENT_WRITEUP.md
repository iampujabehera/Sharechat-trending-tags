# ShareChat Trending Tags — APM Assignment Writeup

**Author:** Puja Behera · TPM, Medinous · candidate for APM, ShareChat
**Submitted artifacts:** hosted prototype URL · GitHub repo · 2-min Loom · screenshot

---

## 1. User Problem

**Who is the user?**
A 22-year-old Hindi-speaking ShareChat user in Patna, Indore, or Bhilwara. Reads in Devanagari. Opens the app 4–6× a day for 2–8 minutes a session. Scrolls fast. Taps only when something *feels* alive to them — not because they were told it was important.

**What's broken today?**
Trending Tags are one of the most prominent feed entry points, but they suffer from three real failure modes:

1. **Manual curation doesn't scale across 14+ languages.** A human editor in Bengaluru cannot reliably surface what a Bhojpuri user in Bihar cares about today. Manual curation is also slow — a topic that breaks at 11 AM may not appear in the strip till 3 PM.
2. **Even when curation is fast, the *copy* is dead.** The default LLM/editor instinct is summary copy ("इस विषय की पूरी जानकारी पढ़ें", "यह सोशल मीडिया पर ट्रेंड कर रहा है"). That language *closes* the curiosity loop. The user reads it and concludes there's nothing left to discover. They scroll past.
3. **The signal mix is biased.** Most "trending" systems lean heavily on news APIs because they're the easiest to ingest. But news lags social. A topic going viral on Reddit or YouTube at 9 AM doesn't show up on news wires until 6 PM. The trending strip should reflect *what India is talking about right now*, not *what publishers wrote about yesterday*.

**Why does this hurt ShareChat specifically?**
Trending Tags sit at the top of the feed — they're a discovery surface. If they fail, users default to the personalized feed alone. They miss topical content, miss creator discovery, and the "what India is talking about right now" promise quietly breaks. At ShareChat's scale, even a 2% drop in trending-strip CTR is millions of foregone discovery sessions per day.

---

## 2. Opportunity Size

*All numbers are assumptions justified inline. ShareChat-internal data would refine these by 1–2 orders of magnitude.*

**Top-down sizing:**

| Input | Assumption | Source / justification |
|---|---|---|
| ShareChat DAU | ~180M | Publicly stated 2023–24 figures |
| % of sessions where user sees the trending strip | 60% | Strip is above-the-fold on home; ~40% of sessions are direct deep-links into a single post |
| Trending-strip-eligible users / day | ~108M | DAU × 60% |
| Current trending-strip CTR (assumed) | 6% | Industry baseline for "see what's hot" rails on consumer social platforms |
| Current taps on trending / day | ~6.5M | Eligible × CTR |
| Target CTR after intervention | 9% | +50% relative lift, achievable via better hooks + better signal mix (industry precedent: Twitter's "Explore" redesign delivered comparable lifts) |
| Incremental tag-taps / day | ~3.2M | (108M × 0.09) − (108M × 0.06) |
| Avg session-time gain per incremental tap | ~2 min | One tap → tag landing → 2–3 posts consumed |
| Daily incremental session-time | ~6.5M minutes | 3.2M × 2 min |

**Translation into business outcome:**
- ~6.5M extra user-minutes/day = ~108K user-hours/day
- At ShareChat's blended ad eCPM (~₹15 per 1000 impressions, conservative estimate) and ~3 ad impressions per minute on tag landing pages, this is roughly **₹2.5–3 Cr/month incremental ad revenue at full rollout**.
- Recovery period for a build of this scope (10–14 hrs of focused work + ~2 weeks of integration) is well inside the 3-month payback window mentioned for Problem 1's monetization rule.

**Why this is conservative:**
We have not modelled (a) downstream creator monetization from new tag-followers, (b) retention lift from "I find new things on ShareChat" perception, (c) the second-order effect of trending-tag taps feeding the personalized feed's interest graph. Real opportunity is likely 2–3× this floor.

---

## 3. Feature Design

The feature ships as **two coupled components**: a backend engine that auto-discovers trending topics, and a UX layer that surfaces them in the feed.

### 3.1 The engine — 5-stage pipeline

```
Sources (7) → INGEST → EXTRACT → CLUSTER → SCORE → SPLIT → Output
```

| Stage | Tech / Model | Why this choice |
|---|---|---|
| Ingest | `Promise.allSettled` over 7 sources, 8s timeout each | Per-source isolation. One bad feed cannot 502 the whole API. |
| Extract | OpenAI `gpt-4o-mini` with opinionated few-shot Hindi prompt | LLM is the only feasible way to cluster + write Hindi hooks in one pass. `gpt-4o-mini` is the cheapest reliable-JSON model (~$0.005/call, 700 calls per $5). |
| Cluster | Deterministic in-process dedupe by normalized tag | Belt-and-suspenders against LLM duplicate output. Doesn't need creativity → no LLM. |
| Score | 4-component weighted formula | Auditable, tunable, defensible. Each component answers a specific question. |
| Split | Two arrays — trending leaderboard + calendar-only "Today" strip | Calendar is predictable, news/social is unpredictable. Different lanes, different reads. |

**Source mix (mapped to assignment's 4 signal types):**

| Assignment signal | Source we use | Rationale |
|---|---|---|
| What people are searching for | Google Trends India RSS | Closest free proxy to in-app search — ShareChat-internal would replace this in production |
| What's spiking in posts/views | Reddit r/india + r/cricket + r/bollywood | Proxy for social discussion. ShareChat-internal post-velocity would replace this. |
| What's breaking in the news | NewsAPI + 5 Indian RSS feeds (NDTV, TOI, The Hindu, Gadgets360, NDTV Cricket) | Same as production |
| What's viral on other platforms | YouTube Trending IN | X API paid, Insta API closed — YouTube is the only free virality proxy |
| Cultural context | Local cultural calendar JSON | Solves cold-start: Buddha Purnima matters even if NDTV hasn't covered it yet |

**Heat scoring formula:**
```
heatScore = 0.30 × sourceScore   ← weighted-sum (NOT raw count); google_trends > youtube > reddit > news
          + 0.25 × relevance     ← model's 0–1 India-relevance verdict
          + 0.35 × velocity      ← signal-type diversity proxy (cross-channel = trending hard)
          + 0.10 × calendar      ← mild tiebreaker only — calendar can't dominate
```

Velocity carries the highest weight because *trending* literally means *rising-right-now*. Source count alone would surface evergreen topics (cricket, Bollywood) over genuine spikes — the failure mode of bad trending systems.

### 3.2 The UX — feed-native, mobile-first, Hindi-first

| Decision | What we chose | What we considered & rejected |
|---|---|---|
| Layout | Vertical scrollable cards | Horizontal carousel — phone scroll is vertical; users miss anything past card 3 |
| Heat indicator | Bar AND number (0–100) | Bar alone has no comparison scale; number alone has no "feel" |
| Language mix | Hindi `displayName` + `description`, English `tag` (e.g. `#TeamIndia`) | All-English (loses Bharat audience); all-Hindi hashtags (broken on Twitter/Insta cross-share) |
| Detail interaction | Slide-up bottom-sheet overlay | New route — would lose user's scroll position in feed |
| Loading state | Skeleton with Hindi copy ("आज के trends ढूंढ रहे हैं... 🔍") | Generic spinner — misses opportunity to reinforce vernacular identity even at loading |
| Refresh | Manual pull-to-refresh, 25-min cache | Auto-refresh every 30s — would jank scroll for negligible info gain |
| Two strips | "Trending" (ranked) + "आज का दिन" (calendar carousel) | One mixed list — festivals would dominate trending leaderboard with no signal density |

### 3.3 The detail view — variable-reward triad (Hook framework)

The trend detail overlay is shaped after Nir Eyal's Hook model (tribe / hunt / self) rather than a Wikipedia "summary + sources" layout. This is the highest-leverage UX decision in the prototype.

- **🌍 लोग क्या कह रहे हैं (Tribe)** — sample reactions, post counts, regional skew. Reward = social belonging.
- **🎬 अंदर क्या मिलेगा (Hunt)** — three teaser cards for content the user will discover. Reward = curiosity satisfied.
- **💫 आपके लिए क्यों (Self)** — one-line personal angle keyed to user mood/identity. Reward = identity affirmation.

The AI summary and source-trace are deliberately demoted *below* these three panels — evaluators don't tap a trend to read sources, they tap to feel a reward.

---

## 4. Behavioral Rationale

This section answers *why each design choice works on a human, not technically*.

**Why hook-style descriptions, not summaries.**
Daniel Kahneman's curiosity-gap research and Nir Eyal's variable-reward model both converge on the same insight: a description that *resolves* a question kills the click; a description that *opens* a question earns it. So our extraction prompt explicitly bans summary phrasing ("जानिए...", "यह ट्रेंड कर रहा है") and demands hook phrasing ("एक छोटी सी बात, और इंटरनेट अटक गया"). The grammatical shift is small; the behavioral shift is large.

**Why Hindi content with English hashtags.**
A tier-2 user *recognizes* `#TeamIndia` because hashtags have been ASCII on Twitter and Instagram for over a decade — that visual pattern carries cross-platform identity. But the *description* is the thing they read for emotional decision-making, and that has to feel like a friend texting them, not a news anchor. Hence Devanagari for narrative, ASCII for the tag itself.

**Why two visually distinct strips, not one ranked list.**
Calendar events and trending news activate different mental models. A festival is *anticipated* (you check the date once, then pre-load the cultural mood). A trend is *discovered* (you encounter it and ask "what's going on?"). Mixing them in one ranked list collapses both into the same "something to do" bucket and confuses both jobs. Splitting them lets each strip respect its own user intent.

**Why the detail view follows tribe/hunt/self instead of summary-first.**
Variable rewards are stickier than fixed rewards (slot machines, Instagram pull-to-refresh, dating apps). When a user taps into a trend, three different reward types are simultaneously available — they get whichever lands first. A pure-summary layout offers only one reward (information), which is the lowest of the three on the dopamine hierarchy.

**Why a manual refresh, not auto-refresh.**
Auto-refresh feels intelligent in a designer's deck and broken in production. The moment the strip mutates while a user is reading, scroll position jumps and they lose the post they were about to tap. Cost > benefit. Manual refresh is honest about when freshness happens.

---

## 5. Metrics & Guardrails ⭐

*This is the section the assignment flagged as "Very important." The structure: north star → primary KPIs → secondary KPIs → guardrail metrics → counter-metrics.*

### North star
**Trending-Strip Tap Rate** = sessions with ≥1 tag-tap / sessions where the strip was visible.

This is the single metric that tells us if the trending strip is doing its job. Everything else is diagnostic.

### Primary KPIs

| KPI | Target | Why |
|---|---|---|
| Trending-strip CTR (taps / impressions) | +30–50% relative vs control | The direct user-action signal |
| Avg taps per active user per day | +0.5 | Are users tapping more than once per session? |
| Median tag-detail dwell time | ≥45 seconds | Tap quality — a tap that ends in 2s is worse than no tap |
| 7-day return rate to trending strip | +10pp | Are we converting one-time tappers into habit? |

### Secondary / diagnostic KPIs

- **Per-category tap distribution** — surface mix balance. If 80% of taps are cricket, the system is collapsing into one category.
- **Per-source contribution to top-10** — are we over-relying on Google Trends? On news? Healthy mix = no single source >40% of top-10.
- **Geo-distribution of taps** — Hindi-belt vs metro split. The whole point is Bharat — if metro skews >50%, the prompt isn't filtering metro-bias enough.
- **Hook copy A/B winrate** — gradually rotate description templates and measure which hook structures perform.

### Guardrails (the things we protect against)

| Guardrail | Threshold | Action if breached |
|---|---|---|
| Hallucination rate | ≤2% of topics flagged in human spot-check | Tighten extraction prompt, add post-hoc fact-check call |
| Per-publisher source dominance | No single publisher contributes >25% of top-10 votes | Cap publisher influence in scoring |
| Latency p95 | <800ms | Auto-fallback to cached trending if exceeded |
| Cost per 1000 invocations | <$0.50 OpenAI spend | Budget alarms, switch to lighter model if breached |
| Post-tap dwell <5s rate | <15% of taps | Indicates clickbait pattern; rewrite hook prompts |
| Regional fairness (% non-metro tags) | ≥40% of top-10 | Boost regional signal weights if breached |

### Counter-metrics (what we'd be sad to lift)

- **Personalized feed CTR** — if trending taps cannibalize feed engagement, we've moved attention but not added it.
- **Time-to-first-post** — trending strip should not delay primary content consumption.
- **Negative reactions on tagged content** — "report" / "not interested" rates by tag.

### Data instrumentation needed

- Impression event per strip render (with `slot_position` + `tag_id`)
- Tap event with `tag_id` + `dwell_after_tap`
- Source attribution event per topic served (`source_mix` array)
- Daily hallucination sample for QA (10 random tags / day → human review)

---

## 6. Experiment Plan

### Phase 0 — Internal validation (Week 0, 3 days)
Pipeline runs in shadow mode. Output logged to a dashboard. Compare side-by-side with current manually-curated trending strip. Internal QA reviews 50 randomly-sampled outputs for hallucinations, tone, India-relevance.
**Exit criterion:** ≤2% hallucination, ≥80% editorial agreement.

### Phase 1 — Limited A/B (Weeks 1–2)
- **Population:** 5% of Hindi-language DAU (≈5M users)
- **Allocation:** 50/50 control vs treatment, randomized at user_id
- **Treatment arm:** new pipeline + hook descriptions + two-strips UI
- **Control arm:** existing trending strip
- **Primary hypothesis:** Tap Rate +30% relative
- **Secondary hypotheses:** dwell time +20%, 7-day return +5pp
- **Sample-size justification:** at 6% baseline CTR, 5M users × 14 days gives MDE ~1.5pp at α=0.05, β=0.2 — enough to detect a 25% relative lift confidently
- **Pre-registered kill criteria:** Tap Rate −10% OR dwell −15% OR latency p95 >1.5s OR personalized-feed CTR −5%

### Phase 2 — Geo + language expansion (Weeks 3–4)
Roll to 25% of Hindi DAU + start Bengali / Marathi / Tamil pilots (5% each). Translate the prompt — same hook rules, different language. Validate per-language hallucination rate before scaling.

### Phase 3 — Region-aware ranking (Weeks 5–6)
Wire up `relevantRegions` in the calendar to actually filter/boost. A Bihari user sees Chhath Puja boosted; a Keralite sees Onam. Run as a separate A/B inside the treatment arm (treatment + region-aware vs treatment only).

### Phase 4 — Full rollout + monetization layer (Weeks 7–8)
- 100% rollout if Phase 1+2 metrics hold
- Introduce **1 sponsored slot** in the trending strip, clearly labeled, capped at 1-of-10
- Measure ad revenue uplift vs trending CTR — sponsored slot must not depress organic CTR by >10%

### What we'd build with 4 more weeks (assignment-mandated section)

1. **Real time-bucketed velocity.** Replace the signal-diversity proxy with actual Δcount over 30/60/120-min windows. Needs a Redis store. Highest single accuracy gain.
2. **Region-aware boosting at runtime.** Calendar already has `relevantRegions`; wire into heat formula.
3. **Multi-language displayName + description.** One extra OpenAI step in extraction. Ships ShareChat's 14-language identity, not Hindi-only.
4. **Inline "why is this trending" caption on each card.** 8-token Hindi line generated in the same extraction call (one extra field). Saves the user from tapping to understand — the highest-impact UX upgrade per minute of dev time.
5. **Real investment loop (Hook framework stage 4).** Follow toggle today is local-state. Wire it to a follow graph + push notification when followed tag re-ignites. This is the loop that compounds retention.

---

## Monetization awareness (cross-cutting)

Even though Problem 2 doesn't require a monetization argument, ShareChat's evaluation rubric weighs it for Problem 1 — and trending tags are a natural inventory:

- **Sponsored Trending Slot.** 1 brand-paid slot in top-10, ad-labelled. CPM premium because tag-tappers are high-intent. Capped to protect organic trust.
- **Trend-based ad targeting.** Lookalike audiences against tap-graphs (e.g. "users who tapped #IPL2026 in last 7 days") for advertisers in adjacent verticals.
- **Creator topic challenges.** Trending tags become weekly creator briefs — boost creator earnings, increase post supply against the trend, completes the supply-side loop.

3-month payback math: at projected ₹2.5–3 Cr/month incremental ad revenue, even a generous ₹50L build + integration cost recovers in <30 days.

---

## Honest gaps (carried forward from engineering README)

1. No real time-bucketed velocity (proxied via signal-diversity)
2. No geo-within-India weighting at runtime
3. No real investment loop (follow toggle is local state)
4. No anti-manipulation per-publisher cap
5. Mock discovery copy in detail-view tribe/hunt/self panels
6. Hindi-only displayName (14-language vision is on Phase 2)

These are **deliberate exclusions, not oversights**, scoped by the 10–14 hour budget. Each is named with its production fix.

---

## Tools used (assignment requires honesty here)

- **Claude Code (Opus 4.7)** — primary scaffolding, prompt design, scoring formula, README, this writeup
- **OpenAI API (`gpt-4o-mini`)** — runtime extraction + summary generation
- **Next.js 14 App Router + Tailwind** — hosted on Vercel
- **rss-parser** — ingest layer

---

## Submission checklist

- [ ] Hosted prototype URL
- [ ] GitHub repo URL
- [ ] 2-min Loom walkthrough URL
- [ ] Screenshot of trending tags list (one recent invocation)
