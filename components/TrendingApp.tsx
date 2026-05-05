"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrendingResponse, TrendingTag, Category } from "@/lib/types";
import TrendDetailOverlay from "./TrendDetailOverlay";

const CATEGORY_COLORS: Record<Category, string> = {
  cricket: "#3B82F6",
  entertainment: "#8B5CF6",
  politics: "#EF4444",
  weather: "#06B6D4",
  festival: "#F59E0B",
  finance: "#10B981",
  tech: "#6366F1",
  other: "#6B7280",
};

const CATEGORY_LABELS_HI: Record<Category, string> = {
  cricket: "क्रिकेट",
  entertainment: "मनोरंजन",
  politics: "राजनीति",
  weather: "मौसम",
  festival: "त्योहार",
  finance: "पैसा",
  tech: "टेक",
  other: "अन्य",
};

const TABS = [
  { id: "trending", label: "🔥 Trending", active: true },
  { id: "video", label: "🎥 Video" },
  { id: "following", label: "👥 Following" },
  { id: "festival", label: "🎭 Festival" },
] as const;

interface Props {
  initialData?: TrendingResponse;
  initialError?: string;
}

export default function TrendingApp({ initialData, initialError }: Props) {
  const [data, setData] = useState<TrendingResponse | undefined>(initialData);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("trending");
  const [selectedTag, setSelectedTag] = useState<TrendingTag | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Tick "X minutes ago" once a minute, without a re-fetch.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch("/api/trending?refresh=1", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = (await res.json()) as TrendingResponse;
      setData(fresh);
      setNow(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PhoneFrame
        clockNow={now}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={refresh}
      >
        {activeTab === "trending" && (
          <TrendingTabContent
            data={data}
            error={error}
            loading={loading}
            now={now}
            onSelect={(t) => setSelectedTag(t)}
          />
        )}
        {activeTab === "festival" && (
          <FestivalTabContent
            data={data}
            loading={loading}
            onSelect={(t) => setSelectedTag(t)}
          />
        )}
        {(activeTab === "video" || activeTab === "following") && (
          <ComingSoon tab={activeTab} />
        )}
      </PhoneFrame>

      {selectedTag && (
        <TrendDetailOverlay
          tag={selectedTag}
          onClose={() => setSelectedTag(null)}
          // Only the #1 trending tag gets the live "Show post" → DALL-E
          // image-generation flow. Limiting to one tag is a deliberate
          // cost-control choice; see /api/generate-post for the rationale.
          isTop={!!data?.tags?.[0] && selectedTag.id === data.tags[0].id}
        />
      )}
    </>
  );
}

// ----------------------- phone frame -----------------------------------
// Shell layout (flex column, no calc'd heights):
//
//   .app-shell  ← sized by globals.css: full viewport on mobile,
//                 393×min(852,100dvh-48) frame on desktop preview
//   ├── status bar      ← desktop preview only (sm:flex), hidden on mobile
//   ├── header          ← shrink-0, safe-pt for notch on iPhone
//   ├── tab strip       ← shrink-0
//   ├── content         ← flex-1, overflow-y-auto
//   └── bottom nav      ← shrink-0, safe-pb for home indicator on iPhone
//
// Nothing is absolutely positioned — that's why content can't overlap
// the bottom nav and the bottom nav can't be pushed off-screen.

function PhoneFrame(props: {
  clockNow: Date;
  activeTab: (typeof TABS)[number]["id"];
  onTabChange: (id: (typeof TABS)[number]["id"]) => void;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const time = props.clockNow.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="app-shell">
      {/* Fake status bar — preview-only. On real mobile devices we use
          the actual OS status bar + safe-area-inset-top instead. */}
      <div className="hidden sm:flex h-[54px] items-end justify-between px-[30px] pb-2 text-[14px] font-semibold shrink-0">
        <div>{time}</div>
        <div className="flex items-center gap-1 text-xs">
          <span>5G</span>
          <span>📶</span>
          <span>🔋</span>
        </div>
      </div>

      {/* Header */}
      <div className="safe-pt flex items-center gap-2 px-4 py-2 bg-sc-black shrink-0">
        <div className="flex-1 min-w-0 bg-sc-surface2 rounded-[20px] px-4 py-[10px] text-[13px] text-sc-text2 truncate">
          🔍 हिंदी में search करें...
        </div>
        <button
          onClick={props.onRefresh}
          aria-label="Refresh trends"
          className="shrink-0 w-9 h-9 rounded-full bg-sc-surface2 flex items-center justify-center text-[16px] hover:bg-[#222] active:scale-95 transition"
        >
          🔔
        </button>
        <button
          aria-label="Chat"
          className="shrink-0 w-9 h-9 rounded-full bg-sc-surface2 flex items-center justify-center text-[16px]"
        >
          💬
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 px-3 overflow-x-auto bg-sc-black border-b border-[var(--border)] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => props.onTabChange(tab.id)}
            className={`relative px-[14px] py-[10px] text-[13px] font-medium whitespace-nowrap transition shrink-0 ${
              props.activeTab === tab.id ? "text-sc-blue font-bold" : "text-sc-text2"
            }`}
          >
            {tab.label}
            {props.activeTab === tab.id && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-t-[2px] bg-sc-blue" />
            )}
          </button>
        ))}
      </div>

      {/* Content — fills the remaining height between header/tabs and
          the bottom nav. No hardcoded heights; flex does the work. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2"
        style={{ overscrollBehaviorY: "contain" }}
      >
        {props.children}
      </div>

      {/* Bottom nav — last child of the flex column. The .bottom-nav
          class adds safe-area-inset-bottom padding for iPhone home-bar. */}
      <div className="bottom-nav flex items-center justify-around">
        {[
          { ic: "🏠", lb: "Home", active: true },
          { ic: "🔍", lb: "Search" },
          { ic: "➕", lb: "Create" },
          { ic: "📡", lb: "LIVE" },
          { ic: "👤", lb: "Profile" },
        ].map((n) => (
          <button
            key={n.lb}
            className="flex flex-col items-center gap-[2px] py-2 px-2 min-w-[48px] flex-1 max-w-[80px]"
          >
            <span className="text-[clamp(18px,5.5vw,22px)] leading-none">{n.ic}</span>
            <span
              className={`text-[9px] font-medium ${
                n.active ? "text-sc-blue font-bold" : "text-sc-text3"
              }`}
            >
              {n.lb}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ----------------------- trending tab ----------------------------------

function TrendingTabContent(props: {
  data?: TrendingResponse;
  error?: string;
  loading: boolean;
  now: Date;
  onSelect: (t: TrendingTag) => void;
}) {
  if (props.loading) return <SkeletonList />;
  if (props.error && !props.data) return <ErrorState message={props.error} />;
  if (!props.data || props.data.tags.length === 0) return <EmptyState />;

  const minsAgo = minutesBetween(new Date(props.data.fetchedAt), props.now);
  const sourceCount = props.data.totalSources;
  const todayStrip = props.data.today ?? [];

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3 pb-2 text-[11px] text-sc-text2">
        <span>
          {minsAgo === 0 ? "अभी अपडेट हुआ" : `${minsAgo} मिनट पहले अपडेट हुआ`}
          {" • "}
          {sourceCount} {sourceCount === 1 ? "जगह से" : "जगहों से"}
        </span>
      </div>

      {/* "आज का दिन" — calendar-driven, separate visual lane so festivals
          don't crowd the trending leaderboard. */}
      {todayStrip.length > 0 && (
        <TodayStrip tags={todayStrip} onSelect={props.onSelect} />
      )}

      {/* Trending leaderboard — news/social signal driven.
          Section header matches ShareChat's actual UI exactly: "TRENDING TAGS"
          in English uppercase. Even on Hindi-first surfaces ShareChat keeps
          structural section labels in English (consistent with Swiggy, Zomato,
          BookMyShow patterns); we follow the same convention so the strip
          feels native rather than an outsider's reinterpretation. */}
      <div className="px-4 pt-3 pb-1">
        <div className="text-[11px] font-bold text-sc-text2 uppercase tracking-[0.08em]">
          Trending tags
        </div>
      </div>
      <div className="flex flex-col">
        {props.data.tags.map((t) => (
          <TrendCard key={t.id} tag={t} onTap={() => props.onSelect(t)} />
        ))}
      </div>
    </>
  );
}

// Horizontal scrollable strip for calendar-driven topics. Visually distinct
// from the main leaderboard:
//   - Section header has a stronger accent line + "live" pulse on day-of
//   - Cards use category-color gradient backgrounds (not flat black)
//   - Larger emoji, countdown badge, no heat score
// Reads as "today's editorial context", not "today's leaderboard".
function TodayStrip({
  tags,
  onSelect,
}: {
  tags: TrendingTag[];
  onSelect: (t: TrendingTag) => void;
}) {
  // Detect any "today" event (heatScore == 100 means daysUntil = 0).
  const hasTodayEvent = tags.some((t) => t.heatScore >= 100);

  return (
    <>
      {/* Section header — matches ShareChat's "TRENDING TAGS" uppercase-English
          structural pattern. The Hindi "आज का दिन" sits as a subtitle so the
          editorial concept (today's calendar context) is still legible. */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-bold text-sc-text2 uppercase tracking-[0.08em]">
            Today · आज का दिन
          </div>
          {hasTodayEvent && (
            <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-sc-orange bg-sc-orange/10 px-2 py-[2px] rounded-full">
              <span
                className="w-[6px] h-[6px] rounded-full bg-sc-orange"
                style={{ animation: "pulse 1.6s ease-in-out infinite" }}
              />
              LIVE
            </span>
          )}
        </div>
      </div>
      <div
        className="flex gap-[10px] px-3 pb-3 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {tags.map((t) => (
          <TodayChip key={t.id} tag={t} onTap={() => onSelect(t)} />
        ))}
      </div>
    </>
  );
}

// Larger, color-tinted chip. Three states reflected visually:
//   - "आज" (today)           → solid accent gradient + pulse on the badge
//   - "X दिन में" (upcoming) → softer accent tint + countdown badge
//   - regional event         → small region badge in corner
function TodayChip({ tag, onTap }: { tag: TrendingTag; onTap: () => void }) {
  const accent = CATEGORY_COLORS[tag.category];
  const isToday = tag.heatScore >= 100;
  const countdown = countdownLabel(tag.description);

  return (
    <button
      onClick={onTap}
      className="shrink-0 w-[240px] text-left rounded-[14px] p-[14px] active:scale-[0.985] transition relative overflow-hidden border"
      style={{
        background: isToday
          ? `linear-gradient(135deg, ${accent}40 0%, ${accent}15 60%, #000000 100%)`
          : `linear-gradient(135deg, ${accent}25 0%, ${accent}08 70%, #000000 100%)`,
        borderColor: isToday ? `${accent}80` : `${accent}30`,
      }}
    >
      {/* Top row: emoji + countdown badge */}
      <div className="flex items-start justify-between mb-2">
        <span
          className="w-[44px] h-[44px] rounded-[12px] flex items-center justify-center text-[26px] leading-none"
          style={{ background: `${accent}30` }}
        >
          {tag.emoji}
        </span>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
          style={{
            color: isToday ? "#0B0B0B" : accent,
            background: isToday ? accent : `${accent}20`,
          }}
        >
          {countdown}
        </span>
      </div>

      {/* Title */}
      <div className="text-[15px] font-bold text-sc-text truncate mb-1">
        {tag.displayName}
      </div>

      {/* Description */}
      <div className="text-[11px] text-sc-text2 leading-[1.5] line-clamp-2">
        {tag.description}
      </div>
    </button>
  );
}

// Cheap heuristic: pull "आज" / "कल" / "X दिन" out of the description we
// generated server-side. Keeps the chip badge in sync with the copy
// without re-deriving the date math here.
function countdownLabel(description: string): string {
  if (/^आज\b/.test(description) || /\bआज\b/.test(description.slice(0, 14))) {
    return "आज";
  }
  if (/^कल\b/.test(description)) return "कल";
  const match = description.match(/^(\d+)\s*दिन/);
  if (match) return `${match[1]} दिन में`;
  return "जल्द";
}

// Refactored to match ShareChat's actual TRENDING TAGS list pattern: flat rows
// with subtle dividers, emoji as semantic prefix, single-line Hindi headline.
// We keep our differentiator — the hook description — as a smaller second line.
// All the rich metadata (hashtag, rank, source pills, heat bar) moves to the
// detail overlay where it earns its space; on the strip itself it was visual
// noise that competed with the headline for the user's attention.
function TrendCard({ tag, onTap }: { tag: TrendingTag; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="block w-full text-left px-4 py-[11px] active:bg-sc-surface2 hover:bg-sc-surface2 transition border-b border-[var(--border)]"
    >
      <div className="flex items-start gap-3">
        {/* Emoji as semantic prefix — same role ShareChat's 📢 / 😢 play */}
        <span className="text-[20px] leading-none mt-[2px] shrink-0">
          {tag.emoji}
        </span>

        <div className="flex-1 min-w-0">
          {/* Hindi headline — single line, the primary tap target */}
          <div className="text-[14px] font-semibold text-sc-text truncate">
            {tag.displayName}
          </div>
          {/* Hook description — the differentiator vs ShareChat's headline-only
              rows. Smaller, second line, single-line truncation so the row stays
              dense. This is the line that earns the tap. */}
          <div className="text-[11px] text-sc-text2 mt-[2px] line-clamp-1 leading-[1.45]">
            {tag.description}
          </div>
        </div>

        {/* Subtle heat indicator on the right. Only rendered when the score
            is high enough to be meaningful — a 50/100 trend doesn't need a
            badge shouting at the user. Color-graded: orange for very hot,
            muted gray for warm. Replaces the full bar+number which was
            dashboard-y on a consumer surface. */}
        {tag.heatScore >= 80 ? (
          <span className="text-[10px] font-bold text-sc-orange shrink-0 mt-[3px] tabular-nums">
            🔥 {tag.heatScore}
          </span>
        ) : tag.heatScore >= 60 ? (
          <span className="text-[10px] text-sc-text3 shrink-0 mt-[3px] tabular-nums">
            {tag.heatScore}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// ----------------------- festival tab ----------------------------------
// Full calendar view: hero card for the biggest "today" event, then the
// remaining upcoming events grouped by week. Reuses the same `today[]`
// array from the trending response — no separate API call needed.

function FestivalTabContent({
  data,
  loading,
  onSelect,
}: {
  data?: TrendingResponse;
  loading: boolean;
  onSelect: (t: TrendingTag) => void;
}) {
  if (loading) return <SkeletonList />;
  const today = data?.today ?? [];

  if (today.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <div className="text-[40px] mb-3">📅</div>
        <div className="text-sc-text font-bold mb-1">कोई event पास में नहीं</div>
        <div className="text-[13px] text-sc-text2">
          अगले 14 दिनों में कोई festival या cricket fixture नहीं है।
        </div>
      </div>
    );
  }

  const happeningToday = today.filter((t) => t.heatScore >= 100);
  const upcoming = today.filter((t) => t.heatScore < 100);

  return (
    <>
      {happeningToday.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="text-[12px] font-bold text-sc-text uppercase tracking-wider">
                🔴 आज
              </div>
              <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-sc-orange bg-sc-orange/10 px-2 py-[2px] rounded-full">
                <span
                  className="w-[6px] h-[6px] rounded-full bg-sc-orange"
                  style={{ animation: "pulse 1.6s ease-in-out infinite" }}
                />
                LIVE
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-[8px] px-3 pb-3">
            {happeningToday.map((t) => (
              <FestivalHeroCard key={t.id} tag={t} onTap={() => onSelect(t)} />
            ))}
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 pt-2 pb-2">
            <div className="text-[12px] font-bold text-sc-text uppercase tracking-wider">
              🗓️ आने वाले events
            </div>
            <div className="text-[10px] text-sc-text3">अगले 14 दिन</div>
          </div>
          <div className="flex flex-col gap-[6px] px-3 pb-6">
            {upcoming.map((t) => (
              <FestivalRow key={t.id} tag={t} onTap={() => onSelect(t)} />
            ))}
          </div>
        </>
      )}

      <div className="px-5 pb-8 text-center">
        <div className="text-[10px] text-sc-text3 leading-[1.5]">
          त्योहार + cricket fixtures · हर तिमाही update
        </div>
      </div>
    </>
  );
}

// Big hero card for today's events. Full-width, gradient bg, prominent emoji.
function FestivalHeroCard({ tag, onTap }: { tag: TrendingTag; onTap: () => void }) {
  const accent = CATEGORY_COLORS[tag.category];
  return (
    <button
      onClick={onTap}
      className="text-left rounded-[16px] p-5 active:scale-[0.99] transition relative overflow-hidden border"
      style={{
        background: `linear-gradient(135deg, ${accent}50 0%, ${accent}20 60%, #000000 100%)`,
        borderColor: `${accent}90`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className="w-[64px] h-[64px] rounded-[16px] flex items-center justify-center text-[40px] leading-none"
          style={{ background: `${accent}40` }}
        >
          {tag.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: accent }}>
            आज का दिन
          </div>
          <div className="text-[20px] font-bold text-sc-text truncate">
            {tag.displayName}
          </div>
        </div>
      </div>
      <div className="text-[13px] text-sc-text leading-[1.55]">
        {tag.description}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span
          className="text-[10px] uppercase tracking-wider font-bold px-2 py-[3px] rounded"
          style={{ background: `${accent}30`, color: accent }}
        >
          {CATEGORY_LABELS_HI[tag.category]}
        </span>
        <span className="text-[11px] text-sc-text2 font-semibold">
          Detail देखें →
        </span>
      </div>
    </button>
  );
}

// Compact row for upcoming events. Date-on-the-left layout — easy to scan
// "what's coming when" in one glance.
function FestivalRow({ tag, onTap }: { tag: TrendingTag; onTap: () => void }) {
  const accent = CATEGORY_COLORS[tag.category];
  const days = countdownLabel(tag.description);
  return (
    <button
      onClick={onTap}
      className="text-left rounded-[12px] p-[12px] active:scale-[0.985] transition border bg-sc-black flex items-center gap-3"
      style={{ borderColor: `${accent}30` }}
    >
      <div
        className="w-[56px] h-[56px] rounded-[12px] flex flex-col items-center justify-center shrink-0"
        style={{ background: `${accent}25` }}
      >
        <span className="text-[22px] leading-none mb-[2px]">{tag.emoji}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {days}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold text-sc-text truncate">
          {tag.displayName}
        </div>
        <div className="text-[11px] text-sc-text2 mt-[2px] leading-[1.45] line-clamp-2">
          {tag.description}
        </div>
      </div>
      <span className="text-[14px] text-sc-text3">›</span>
    </button>
  );
}

// ----------------------- states ----------------------------------------

function SkeletonList() {
  return (
    <>
      <div className="px-4 pt-3 pb-2 text-[12px] text-sc-text2">
        आज के trends ढूंढ रहे हैं... 🔍
      </div>
      <div className="flex flex-col gap-[6px] px-1">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="skel mx-3 rounded-[12px]"
            style={{ height: 96 }}
            aria-hidden
          />
        ))}
      </div>
    </>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[40px] mb-3">⚠️</div>
      <div className="text-sc-text font-bold mb-1">कुछ गड़बड़ हो गई</div>
      <div className="text-[13px] text-sc-text2 leading-[1.5]">{message}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[40px] mb-3">🤔</div>
      <div className="text-sc-text font-bold mb-1">कोई ट्रेंड नहीं मिला</div>
      <div className="text-[13px] text-sc-text2">कुछ देर बाद फिर try करें।</div>
    </div>
  );
}

function ComingSoon({ tab }: { tab: string }) {
  const tabHi: Record<string, string> = {
    video: "वीडियो",
    following: "Following",
    festival: "त्योहार",
    trending: "ट्रेंडिंग",
  };
  const label = tabHi[tab] ?? tab;
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[40px] mb-3">🚧</div>
      <div className="text-sc-text font-bold mb-1">{label} जल्द आएगा</div>
      <div className="text-[13px] text-sc-text2">अभी के लिए Trending tab पर जाएँ।</div>
    </div>
  );
}

// ----------------------- helpers ---------------------------------------

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}
