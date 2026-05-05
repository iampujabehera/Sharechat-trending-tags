"use client";

import { useEffect, useState } from "react";
import type { Category, TrendingTag } from "@/lib/types";

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

const SOURCE_LABELS: Record<string, { name: string; icon: string }> = {
  newsapi: { name: "NewsAPI · India headlines", icon: "📰" },
  rss: { name: "Indian news RSS", icon: "📡" },
  youtube: { name: "YouTube Trending India", icon: "▶️" },
  google_trends: { name: "Google Trends India · search intent", icon: "🔍" },
  reddit_india: { name: "Reddit · r/india", icon: "💬" },
  reddit_cricket: { name: "Reddit · r/cricket", icon: "🏏" },
  reddit_bollywood: { name: "Reddit · r/bollywood", icon: "🎬" },
};

interface Props {
  tag: TrendingTag;
  onClose: () => void;
  // Only the #1 trending tag gets the live "Show post" image-generation
  // CTA — wired upstream by TrendingApp from data.tags[0].id. Every other
  // tag keeps the existing close-overlay behaviour on the bottom button.
  isTop?: boolean;
}

interface GeneratedPost {
  imageDataUrl: string;
  caption: string;
}

export default function TrendDetailOverlay({ tag, onClose, isTop = false }: Props) {
  const accent = CATEGORY_COLORS[tag.category];
  const [summary, setSummary] = useState<string | null>(tag.aiSummary ?? null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [followed, setFollowed] = useState(false);
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [postLoading, setPostLoading] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (summary) return;
    let abort = false;
    setSummaryLoading(true);
    setSummaryError(null);

    const params = new URLSearchParams({
      tag: tag.tag,
      name: tag.displayName,
      desc: tag.description,
    });
    fetch(`/api/summary?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((j: { summary?: string }) => {
        if (!abort && j.summary) setSummary(j.summary);
      })
      .catch((e) => {
        if (!abort) setSummaryError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!abort) setSummaryLoading(false);
      });

    return () => {
      abort = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag.id]);

  const fresh = freshnessHi(tag.freshness);
  const isToday = tag.kind === "today";

  // Discovery copy — generated from category, not API-driven. The prototype
  // demonstrates the variable-reward pattern; production would back these
  // panels with real post counts, sample reactions, and content thumbnails.
  const discovery = buildDiscoveryCopy(tag);

  // On-demand AI post generation — fires only when the user explicitly
  // taps the "Show post" CTA on the #1 trending tag. We deliberately
  // do NOT auto-fetch this on overlay-open: each call costs ~$0.04 for
  // the DALL-E image, so we wait for explicit intent.
  async function handleGeneratePost() {
    if (postLoading || post) return;
    setPostLoading(true);
    setPostError(null);
    try {
      const params = new URLSearchParams({
        tag: tag.tag,
        name: tag.displayName,
        desc: tag.description,
        category: tag.category,
      });
      const res = await fetch(`/api/generate-post?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPost({ imageDataUrl: data.imageDataUrl, caption: data.caption });
    } catch (e) {
      setPostError(e instanceof Error ? e.message : String(e));
    } finally {
      setPostLoading(false);
    }
  }

  return (
    <>
      <div className="overlay-backdrop" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detail: ${tag.displayName}`}
        className="detail-sheet fixed inset-x-0 bottom-0 z-[60] mx-auto sm:max-w-[393px] bg-sc-black border-t border-[var(--border)] rounded-t-[24px] overflow-y-auto overflow-x-hidden"
        style={{
          animation: "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-[3px] rounded-full bg-[#444]" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-sc-surface2 flex items-center justify-center text-[18px] active:scale-95"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-sc-blue truncate">{tag.tag}</div>
            <div className="text-[10px] text-sc-text2">
              {isToday ? "🎯 आज का दिन" : "🔥 ट्रेंडिंग"}
              {" · "}
              {fresh}
            </div>
          </div>
          <button
            aria-label="Share"
            className="w-9 h-9 rounded-full bg-sc-surface2 flex items-center justify-center text-[16px] active:scale-95"
          >
            🔗
          </button>
        </div>

        {/* Hero */}
        <div className="text-center pt-3 pb-5 px-6 border-b border-[var(--border)]">
          <div className="text-[60px] leading-none mb-2">{tag.emoji}</div>
          <div className="text-[22px] font-bold mb-2">{tag.displayName}</div>
          <div className="text-[14px] leading-[1.55] text-sc-text2 max-w-[300px] mx-auto">
            {tag.description}
          </div>

          {/* Heat meter — only on trending entries. Calendar entries already
              communicate "when" via the "आज का दिन · X घंटे पहले" chip in
              the header, so the bar+number adds no info and reads like debug. */}
          {!isToday && (
            <div className="mt-4 max-w-[260px] mx-auto">
              <div className="heat-bar">
                <span style={{ width: `${tag.heatScore}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Tribe — "लोग क्या कह रहे हैं" — social proof.
            Hidden for calendar-only entries: there is no real "tribe of users
            heatedly discussing Buddha Purnima on Reddit." Tribe maps to news
            trends with active social signal, not predictable festival days. */}
        {!isToday && (
          <DiscoveryPanel
            icon="🌍"
            label="लोग क्या कह रहे हैं"
            accent={accent}
            subtitle={discovery.tribe.headline}
          >
            <div className="flex flex-col gap-[6px]">
              {discovery.tribe.reactions.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-sc-surface2 rounded-[10px] px-3 py-2"
                >
                  <span className="text-[16px] leading-none mt-[1px]">{r.icon}</span>
                  <span className="text-[12px] leading-[1.5] text-sc-text">{r.text}</span>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-sc-text3 mt-2">
              {discovery.tribe.footnote}
            </div>
          </DiscoveryPanel>
        )}

        {/* Hunt — "अंदर क्या मिलेगा" — what's inside if you tap */}
        <DiscoveryPanel
          icon="🎬"
          label="अंदर क्या मिलेगा"
          accent={accent}
          subtitle={discovery.hunt.headline}
        >
          <div className="flex flex-col gap-[6px]">
            {discovery.hunt.teasers.map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-sc-surface2 rounded-[10px] px-3 py-[10px]"
              >
                <span
                  className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center text-[18px] shrink-0"
                  style={{ background: `${accent}25` }}
                >
                  {t.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-sc-text truncate">
                    {t.title}
                  </div>
                  <div className="text-[10px] text-sc-text3 mt-[1px]">{t.meta}</div>
                </div>
                <span className="text-[10px] text-sc-text3">›</span>
              </div>
            ))}
          </div>
        </DiscoveryPanel>

        {/* Self — "आपके लिए क्यों" — personal angle.
            Hidden for calendar entries: festivals don't need a "why this is for
            you" identity hook — the festival itself IS the identity prompt. */}
        {!isToday && (
          <DiscoveryPanel
            icon="💫"
            label="आपके लिए क्यों"
            accent={accent}
          >
            <div className="text-[13px] leading-[1.6] text-sc-text">
              {discovery.self}
            </div>
          </DiscoveryPanel>
        )}

        {/* AI Summary — secondary, but still here.
            We deliberately do NOT show the model name in the UI — consumer
            users don't care which model wrote the line, and exposing it is
            a debug-leak signal that erodes trust in the surface. */}
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="text-[10px] text-sc-text2 uppercase tracking-wider font-bold mb-2">
            🤖 AI में 30 second
          </div>
          {summaryLoading && (
            <div className="space-y-2">
              <div className="skel rounded h-3 w-full" />
              <div className="skel rounded h-3 w-[88%]" />
              <div className="skel rounded h-3 w-[72%]" />
            </div>
          )}
          {summaryError && (
            <div className="text-[12px] text-sc-text3">
              Summary अभी load नहीं हुआ — main story ऊपर पढ़ लें।
            </div>
          )}
          {summary && (
            <div className="text-[13px] leading-[1.6] text-sc-text2">{summary}</div>
          )}
        </div>

        {/* Sources — collapsed provenance footer.
            Header softened from English "Signal trace" → Hindi "ये कहाँ से आया"
            (this is a consumer surface, not an admin dashboard). For calendar
            entries we drop the right-side "calendar only" technical label —
            the Hindi sentence below already conveys it in user-readable form. */}
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-sc-text2 uppercase tracking-wider font-bold">
              📡 ये कहाँ से आया
            </div>
            {tag.sourceCount > 0 && (
              <div className="text-[10px] text-sc-text3">
                {tag.sourceCount} sources
              </div>
            )}
          </div>
          {tag.sourceCount === 0 ? (
            <div className="text-[11px] text-sc-text3 leading-[1.5]">
              ये entry ShareChat के cultural calendar से आई है — खबर ने अभी पकड़ नहीं
              बनाई, लेकिन आज का दिन है।
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tag.sources.map((s) => {
                const meta = SOURCE_LABELS[s] ?? { name: s, icon: "📡" };
                return (
                  <span
                    key={s}
                    className="text-[10px] bg-sc-surface2 rounded px-2 py-[3px] text-sc-text2"
                  >
                    {meta.icon} {meta.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* AI-generated post — only rendered after the user taps "Show post"
            on the #1 trending tag. Image is base64 (data: URL) so it survives
            the OpenAI URL expiry; the route caches it for an hour. */}
        {isTop && (post || postLoading || postError) && (
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="text-[10px] text-sc-text2 uppercase tracking-wider font-bold mb-2">
              📸 AI से बनाया गया post
            </div>
            {postLoading && (
              <div className="space-y-2">
                <div
                  className="skel rounded-[12px] w-full"
                  style={{ aspectRatio: "1 / 1" }}
                />
                <div className="skel rounded h-3 w-full" />
                <div className="skel rounded h-3 w-3/4" />
                <div className="text-[11px] text-sc-text3 pt-1">
                  Image बन रही है — 10–20 sec लग सकते हैं
                </div>
              </div>
            )}
            {postError && (
              <div className="text-[12px] text-sc-text3 leading-[1.5]">
                Post नहीं बन पाई — {postError.slice(0, 80)}.{" "}
                <button
                  onClick={() => {
                    setPost(null);
                    setPostError(null);
                    handleGeneratePost();
                  }}
                  className="text-sc-blue font-bold underline"
                >
                  दोबारा try करें
                </button>
              </div>
            )}
            {post && (
              <div className="rounded-[12px] overflow-hidden bg-sc-surface2 border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.imageDataUrl}
                  alt={`AI-generated post for ${tag.displayName}`}
                  className="w-full block"
                  style={{ aspectRatio: "1 / 1", objectFit: "cover" }}
                />
                <div className="p-3 text-[13px] leading-[1.6] text-sc-text whitespace-pre-wrap">
                  {post.caption}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sticky-ish CTA cluster: Follow + (Show post | Posts देखें) */}
        <div className="px-5 py-4 pb-7 flex gap-2">
          <button
            onClick={() => setFollowed((v) => !v)}
            className={`shrink-0 px-4 py-3 rounded-[12px] text-[13px] font-bold border transition active:scale-[0.99] ${
              followed
                ? "bg-sc-surface2 text-sc-text border-[var(--border)]"
                : "bg-sc-surface2 text-sc-text border-[var(--border)] hover:bg-[#222]"
            }`}
            style={
              followed
                ? { borderColor: accent, color: accent }
                : undefined
            }
          >
            {followed ? "✓ Followed" : "+ Follow"}
          </button>
          {isTop ? (
            // The #1 trending tag: clicking the blue CTA generates an AI
            // image + Hindi caption inline. After the post renders, the
            // button switches to a plain close action.
            <button
              onClick={post ? onClose : handleGeneratePost}
              disabled={postLoading}
              className="flex-1 bg-sc-blue text-white text-[14px] font-bold py-3 rounded-[12px] active:scale-[0.99] transition disabled:opacity-60"
            >
              {postLoading
                ? "बना रहे हैं..."
                : post
                ? "बंद करें"
                : "📸 Show post →"}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 bg-sc-blue text-white text-[14px] font-bold py-3 rounded-[12px] active:scale-[0.99] transition"
            >
              Posts देखें →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---- discovery panel layout primitive --------------------------------

function DiscoveryPanel({
  icon,
  label,
  subtitle,
  accent,
  children,
}: {
  icon: string;
  label: string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[13px]"
          style={{ background: `${accent}25` }}
        >
          {icon}
        </span>
        <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text">
          {label}
        </div>
      </div>
      {subtitle && (
        <div className="text-[12px] text-sc-text2 leading-[1.5] mb-2">{subtitle}</div>
      )}
      {children}
    </div>
  );
}

// ---- discovery copy generator ----------------------------------------
// Mock content for the prototype. Generated from category + tag, not from
// real backend data. In production, each panel would call a real endpoint:
//   tribe   → /api/tag/{id}/reactions   (top comments + reaction counts)
//   hunt    → /api/tag/{id}/posts       (3 best posts ranked by engagement)
//   self    → personalised based on user's past taps + follow graph
// Keeping it inline here so the prototype demonstrates the UX shape.

interface Discovery {
  tribe: {
    headline: string;
    reactions: { icon: string; text: string }[];
    footnote: string;
  };
  hunt: {
    headline: string;
    teasers: { icon: string; title: string; meta: string }[];
  };
  self: string;
}

function buildDiscoveryCopy(tag: TrendingTag): Discovery {
  const cat = tag.category;

  const tribeByCategory: Record<Category, Discovery["tribe"]> = {
    cricket: {
      headline: "Stadium full, timeline और full",
      reactions: [
        { icon: "🔥", text: '"भाई आज तो match में जान आ गई!" — 12k लोग ऐसा बोल रहे' },
        { icon: "😱", text: '"ये over तो इतिहास में जाएगा" — Twitter पर वायरल' },
        { icon: "🏏", text: "1.4L posts पिछले 2 घंटे में" },
      ],
      footnote: "अधिकतर reactions उत्तर भारत और महाराष्ट्र से",
    },
    entertainment: {
      headline: "हर second WhatsApp पर एक नया screenshot",
      reactions: [
        { icon: "😂", text: '"ये scene तो दिल जीत लिया" — 8k people are laughing' },
        { icon: "💔", text: '"पता नहीं क्यों, लेकिन रो दिया" — emotional posts ⬆' },
        { icon: "🎬", text: "30+ creators ने अपना version बना दिया" },
      ],
      footnote: "Reels में सबसे ज़्यादा share हो रहा सीन",
    },
    politics: {
      headline: "एक तरफ़ celebration, दूसरी तरफ़ critique",
      reactions: [
        { icon: "🔴", text: '"ये फैसला game-changer है" — supporters का दावा' },
        { icon: "🟡", text: '"रुको, अभी पूरी कहानी नहीं आई" — analysts का कहना' },
        { icon: "📊", text: "हिंदी belt में 3.2L posts पिछले 4 घंटे में" },
      ],
      footnote: "अधिकतर बहस UP, बिहार, MP से",
    },
    weather: {
      headline: "हर घर का topic — 'आज और कितना?'",
      reactions: [
        { icon: "🥵", text: '"AC भी हार मान गया आज" — दिल्ली, जयपुर, लखनऊ से posts' },
        { icon: "💧", text: '"पानी की कमी की reports बढ़ रही" — local news' },
        { icon: "🏠", text: "घरेलू नुस्खे और cooling tips trending" },
      ],
      footnote: "Hindi belt में सबसे ज़्यादा concern",
    },
    festival: {
      headline: "घर-घर में आज एक ही mood",
      reactions: [
        { icon: "🪔", text: '"आज तो mom ने पूरा घर सजा दिया!" — family posts ⬆' },
        { icon: "📿", text: '"मंदिर की भीड़ देखो भाई" — viral videos से क्लिप्स' },
        { icon: "🎉", text: "Festival reels और status downloads आज ⬆⬆" },
      ],
      footnote: "Hindi belt + पूरा भारत celebrate कर रहा",
    },
    finance: {
      headline: "हर dukan, हर WhatsApp group में चर्चा",
      reactions: [
        { icon: "📈", text: '"market में आज खेल हो गया" — trader community active' },
        { icon: "💰", text: '"ये decision normal आदमी पर असर डालेगा" — analysts कह रहे' },
        { icon: "🛒", text: "Local market price changes trending" },
      ],
      footnote: "Tier-2/3 cities से सबसे ज़्यादा queries",
    },
    tech: {
      headline: "Tech Twitter में आज तूफ़ान",
      reactions: [
        { icon: "🤯", text: '"ये तो game बदल देगा" — early adopters का दावा' },
        { icon: "🤔", text: '"रुको, hype है या असली कमाल?" — skeptics का सवाल' },
        { icon: "🇮🇳", text: "India-specific use cases discuss हो रहे" },
      ],
      footnote: "Hinglish discussions ज़्यादा, Hindi में posts अब बढ़ रही",
    },
    other: {
      headline: "अलग-अलग कोनों से आ रही reactions",
      reactions: [
        { icon: "💭", text: '"ये unexpected था" — कई लोगों की पहली प्रतिक्रिया' },
        { icon: "🗣️", text: '"अब सब इसी पर बात कर रहे हैं" — feed पर consensus' },
        { icon: "📲", text: "WhatsApp forwards पिछले घंटे में ⬆" },
      ],
      footnote: "Pan-India coverage, multiple angles",
    },
  };

  const huntByCategory: Record<Category, Discovery["hunt"]> = {
    cricket: {
      headline: "अगर आपने अभी तक नहीं देखा, तो miss कर रहे हैं",
      teasers: [
        { icon: "🎥", title: "Match का सबसे बड़ा moment", meta: "Highlight · 32 sec" },
        { icon: "🗣️", title: "Player का post-match interview", meta: "Video · 1.2 min" },
        { icon: "📊", title: "Fan reactions compilation", meta: "Reel · 45 sec" },
      ],
    },
    entertainment: {
      headline: "Reels और posts का flood, top हम छाँटे हैं",
      teasers: [
        { icon: "🎬", title: "Trending scene का behind-the-scenes", meta: "Video · 1 min" },
        { icon: "😂", title: "Best fan reactions और memes", meta: "Reel compilation" },
        { icon: "🌟", title: "Star का latest post", meta: "Image · 2hrs ago" },
      ],
    },
    politics: {
      headline: "Multiple angles — supporters, critics, ज़मीन से",
      teasers: [
        { icon: "📰", title: "क्या हुआ — 1-min summary", meta: "Video · 60 sec" },
        { icon: "🗣️", title: "Local reactions ground se", meta: "Vox pop · 2 min" },
        { icon: "📊", title: "Both sides का analysis", meta: "Read · 4 min" },
      ],
    },
    weather: {
      headline: "Practical tips + on-ground reports",
      teasers: [
        { icon: "🥶", title: "गर्मी से बचने के 7 घरेलू तरीके", meta: "Listicle · 3 min" },
        { icon: "📍", title: "आपके शहर का live status", meta: "Location-aware" },
        { icon: "🎥", title: "Heatwave के असली vlogs", meta: "Reel · 50 sec" },
      ],
    },
    festival: {
      headline: "Devotional + celebration content",
      teasers: [
        { icon: "🪔", title: "आज के लिए status video", meta: "Download-ready" },
        { icon: "📿", title: "Famous मंदिरों से live aarti", meta: "Live · 6.4k watching" },
        { icon: "🎵", title: "Festival songs playlist", meta: "12 tracks" },
      ],
    },
    finance: {
      headline: "Plain Hindi में, बिना jargon",
      teasers: [
        { icon: "💡", title: "आम आदमी पर क्या असर — 60 sec में", meta: "Video" },
        { icon: "📊", title: "Numbers जो मायने रखते हैं", meta: "Visual · 2 min" },
        { icon: "🛒", title: "घर के बजट पर effect", meta: "Read · 3 min" },
      ],
    },
    tech: {
      headline: "हिंदी में explained, बिना technical terms",
      teasers: [
        { icon: "🤖", title: "ये क्या है — 60 sec में समझें", meta: "Video" },
        { icon: "🇮🇳", title: "India में कैसे काम आएगा", meta: "Read · 3 min" },
        { icon: "💬", title: "Tech creators की राय", meta: "Discussion" },
      ],
    },
    other: {
      headline: "Mixed angles — पूरी कहानी एक जगह",
      teasers: [
        { icon: "📺", title: "क्या हुआ — quick recap", meta: "Video · 1 min" },
        { icon: "💬", title: "Community discussions", meta: "Live thread" },
        { icon: "📲", title: "Most-shared posts आज के", meta: "Top 5" },
      ],
    },
  };

  const selfByCategory: Record<Category, string> = {
    cricket:
      "अगर आप वो हैं जो match miss नहीं करते — ये thread आपके लिए है। Highlights, खिलाड़ियों के बयान, fan banter — सब एक जगह।",
    entertainment:
      "नई series, गाने, viral scenes — entertainment की भूख अभी मिटाएँ। 5 मिनट में update हो जाएँगे।",
    politics:
      "जो सोच-समझकर खबर पढ़ते हैं — आपको दोनों तरफ़ की बात मिलेगी। एकतरफ़ा नहीं, ज़मीनी सच।",
    weather:
      "आपका शहर इस मौसम में कैसे जूझ रहा है — और लोग क्या कर रहे हैं। Practical tips + local reports।",
    festival:
      "घर में त्योहार का mood है? यहाँ status, गाने, कहानियाँ — एक जगह सब। Family group के लिए perfect content।",
    finance:
      "पैसे की खबर बिना jargon — कैसे आपकी जेब पर असर पड़ेगा, वो भी हिंदी में, plain।",
    tech:
      "AI, gadgets, apps — जो हिंदी में सबसे आसानी से समझाया गया हो। Tech-curious लोगों के लिए।",
    other:
      "Multi-angle स्टोरी — खबर, reactions, content — सब एक थ्रेड में। आज का pulse एक जगह।",
  };

  return {
    tribe: tribeByCategory[cat],
    hunt: huntByCategory[cat],
    self: selfByCategory[cat],
  };
}

function freshnessHi(iso: string): string {
  try {
    const ts = new Date(iso);
    const mins = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60_000));
    if (mins === 0) return "अभी update हुआ";
    if (mins < 60) return `${mins} मिनट पहले`;
    const hrs = Math.round(mins / 60);
    return `${hrs} घंटा पहले`;
  } catch {
    return "";
  }
}
