import type { CalendarEvent, ExtractedTopic, SourceName } from "../types";

// Heat score formula (per spec):
//
//   heatScore = (sourceScore   × 0.30) +
//               (relevanceScore × 0.25) +
//               (velocityScore × 0.35) +
//               (calendarScore × 0.10)
//
// All sub-scores are 0–100. The final score is rounded and clamped to 100.

// Per-source weights. Different sources tell us different things, so
// counting them equally is wrong. The weights below reflect what each
// source uniquely captures:
//   google_trends → direct user search intent (highest signal)
//   youtube       → viral/cultural video proxy (high signal)
//   reddit_*      → social discussion (medium — English-skewed but useful)
//   newsapi/rss   → breaking news (always present, lower marginal info)
//
// All values are tuning knobs. Saturation point ~3.0 means a topic
// confirmed by 3 well-weighted sources fills the source-score bar.
export const SOURCE_WEIGHTS: Record<SourceName, number> = {
  google_trends: 1.3,
  youtube: 1.1,
  reddit_india: 0.9,
  reddit_cricket: 0.9,
  reddit_bollywood: 0.9,
  newsapi: 0.8,
  rss: 0.8,
};

const SOURCE_SATURATION = 3.0;

export function calculateHeatScore(
  topic: ExtractedTopic,
  calendarBoosts: CalendarEvent[]
): number {
  const sourceScore = calculateSourceScore(topic.mentionedInSources);
  const relevanceScore = topic.indiaRelevanceScore * 100;
  const velocityScore = calculateVelocity(topic.mentionedInSources);
  const calendarScore = getCalendarBoost(topic, calendarBoosts);

  const heat =
    sourceScore * 0.3 +
    relevanceScore * 0.25 +
    velocityScore * 0.35 +
    calendarScore * 0.1;

  return Math.min(100, Math.max(0, Math.round(heat)));
}

// Weighted-sum source score. Replaces the old (count / MAX_SOURCES) ratio
// because not all sources carry the same signal. A topic in google_trends
// alone is more meaningful than the same topic in newsapi alone.
export function calculateSourceScore(sources: SourceName[]): number {
  const weight = sources.reduce(
    (sum, s) => sum + (SOURCE_WEIGHTS[s] ?? 0.8),
    0
  );
  return Math.min(100, (weight / SOURCE_SATURATION) * 100);
}

// "Velocity" approximation — proxy for how fast a topic is spreading. Real
// velocity needs time-bucketed counts (Day-2 work); we proxy via signal-type
// diversity. The intuition: if a topic shows up in BOTH search-intent
// AND viral-video, it's actively spreading right now; if only in one
// signal type, it's a slow-burn or single-channel story.
export function calculateVelocity(sources: SourceName[]): number {
  let score = 50; // baseline if any source has it at all

  // Search intent + viral spread = strong cross-channel velocity.
  const hasSearch = sources.includes("google_trends");
  const hasViral = sources.includes("youtube");
  const hasSocial = sources.some((s) => s.startsWith("reddit_"));
  const hasNews = sources.includes("newsapi") || sources.includes("rss");

  // Each distinct *signal type* (not just source count) adds velocity.
  // News alone = slow burn; news + viral = spreading; news + viral + search = trending hard.
  if (hasSearch) score += 20; // direct user demand right now
  if (hasViral) score += 15; // crossing into viral video
  if (hasSocial) score += 10; // people talking about it
  if (hasNews) score += 5; // press coverage

  // Bonus for genuine cross-source diversity (more sources = harder to fake).
  if (sources.length >= 4) score += 5;

  return Math.min(score, 100);
}

// Returns 0–100. We try fuzzy matching: if either the English tag or
// the Hindi displayName contains the festival/cricket name, the topic
// inherits that event's boost.
export function getCalendarBoost(
  topic: ExtractedTopic,
  calendarBoosts: CalendarEvent[]
): number {
  const tagLower = topic.tag.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dispLower = topic.displayName.toLowerCase();

  for (const e of calendarBoosts) {
    const ename = e.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const ehindi = e.hindiName;
    if (
      (ename.length > 3 && tagLower.includes(ename)) ||
      (ehindi && dispLower.includes(ehindi.toLowerCase())) ||
      (e.name.length > 3 && topic.displayName.includes(e.hindiName))
    ) {
      return Math.round((e.boostScore ?? 0) * 100);
    }
  }
  return 0;
}
