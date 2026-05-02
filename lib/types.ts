// Shared types for the trending pipeline.
// Two layers exist on purpose:
//   - ExtractedTopic = what the model returns (no heatScore yet — we compute it)
//   - TrendingTag    = what /api/trending returns to the UI (heatScore added,
//                      sourceCount derived, aiSummary optionally hydrated)

// SourceName drives signal-trace UI + per-source weighting in scoring.
// Each value here represents a different "kind" of signal:
//   newsapi/rss     → breaking news from publishers
//   youtube         → viral video / social proxy
//   google_trends   → direct user search intent (strongest)
//   reddit_*        → social discussion / cultural buzz
export type SourceName =
  | "newsapi"
  | "rss"
  | "youtube"
  | "google_trends"
  | "reddit_india"
  | "reddit_cricket"
  | "reddit_bollywood";

export type Category =
  | "cricket"
  | "entertainment"
  | "politics"
  | "weather"
  | "festival"
  | "finance"
  | "tech"
  | "other";

// ---- Layer 1: extraction output ----------------------------------------

export interface ExtractedTopic {
  tag: string; // English hashtag, starts with '#'
  displayName: string; // Hindi (Devanagari) display name
  description: string; // One Hindi sentence
  category: Category;
  emoji: string;
  indiaRelevanceScore: number; // 0.0 to 1.0, set by the model
  mentionedInSources: SourceName[]; // which sources surfaced this
}

// ---- Layer 2: API response ---------------------------------------------

// kind discriminates the two strips:
//   "trending" → ranked by news + social signal density (heatScore meaningful)
//   "today"    → calendar-driven (festivals, civic days). heatScore is just
//                a UI affordance; ranking is by date proximity, not signal.
// Mixing them in one ranked list lets calendar dominate trending, which
// is the wrong product behaviour. So we expose two separate arrays.
export type TagKind = "trending" | "today";

export interface TrendingTag {
  id: string; // slug, e.g. "ind-vs-aus-2026"
  tag: string; // hashtag, e.g. "#INDvsAustralia"
  displayName: string; // Hindi
  description: string; // Hindi
  category: Category;
  heatScore: number; // 0-100
  sources: SourceName[]; // which sources confirmed this
  sourceCount: number; // independent source count (== sources.length)
  emoji: string;
  freshness: string; // ISO timestamp
  kind?: TagKind; // defaults to "trending" when absent (back-compat)
  aiSummary?: string; // optional 2-sentence Hindi summary, hydrated lazily
}

export interface TrendingResponse {
  tags: TrendingTag[]; // trending strip — news/social-driven topics
  today?: TrendingTag[]; // optional "आज का दिन" strip — calendar-driven
  fetchedAt: string; // ISO timestamp
  totalSources: number; // count of sources that returned at least one signal
  fromCache: boolean;
  // Optional dev-only diagnostics. Safe to ignore in the UI.
  errors?: { source: string; message: string }[];
}

// ---- Cultural calendar -------------------------------------------------

export interface CalendarEvent {
  name: string; // English
  hindiName: string; // Devanagari
  date: string; // YYYY-MM-DD
  category: Category;
  relevantRegions: string[]; // ["Bihar", "UP"] or ["all"]
  boostDaysBefore: number; // how many days before the date this matters
  emoji: string;
  // Computed at read-time; not stored on disk:
  boostScore?: number; // 0.0–1.0, distance to event date
}
