import { getOpenAI, MODELS } from "../openai";
import type { ExtractedTopic, Category, SourceName } from "../types";

// Combined raw input — what each source contributed. Keeping it as an
// object (not a flat string array) lets us label each chunk for the
// model so it can populate `mentionedInSources` accurately.
export interface RawInput {
  newsapi: string[];
  rss: { title: string; source: string }[];
  youtube: string[];
  google_trends: string[];
  reddit_india: string[];
  reddit_cricket: string[];
  reddit_bollywood: string[];
}

// The description field is the entire product. It's what convinces a tier-2/3
// Hindi user to tap, not scroll past. So the prompt is opinionated: it bans
// the templated "जानिए / देखें / यह ट्रेंड कर रहा है" phrasing that LLMs default to,
// and demands a short curiosity hook. Examples (good + bad) are inline because
// few-shot is the most reliable lever for forcing curiosity-driven copy.
const SYSTEM_PROMPT = `You are a trending topics editor for ShareChat — India's biggest Hindi-first social platform. Your readers are tier-2 and tier-3 Hindi-speaking users; they scroll fast and tap only when something feels alive.

You will be given news headlines, YouTube titles, RSS items, Google Trends rising searches, and Reddit hot posts from Indian sources collected in the last ~30 minutes. Identify up to 15 topics that are genuinely trending for an Indian Hindi-speaking audience right now. Cluster duplicates ("India vs Australia", "#INDvAUS", "Rohit ka shatak" → one topic). Drop anything that is only Western/global noise.

Return a JSON array. Each item must look exactly like this:
{
  "tag": "#HashtagInEnglish",
  "displayName": "हिंदी नाम (Devanagari)",
  "description": "एक छोटी, हुक करने वाली Hindi line",
  "category": "cricket|entertainment|politics|weather|festival|finance|tech|other",
  "emoji": "single relevant emoji",
  "indiaRelevanceScore": 0.0 to 1.0,
  "mentionedInSources": ["newsapi" | "rss" | "youtube" | "google_trends" | "reddit_india" | "reddit_cricket" | "reddit_bollywood"]
}

The seven possible source names mean different things — use them accurately:
- newsapi / rss → mainstream Indian publishers' headlines
- youtube → trending video titles in India (viral / cultural proxy)
- google_trends → real-time search-intent (what users are actively typing)
- reddit_india / reddit_cricket / reddit_bollywood → social discussion (English-skewed but useful signal for what's being talked about)

═══════════════════════════════════════════════════════════════
THE description FIELD IS THE PRODUCT. Read carefully.
═══════════════════════════════════════════════════════════════

It must be:
✅ Hindi (Devanagari) — never English unless it's a brand/proper noun
✅ Short: 8–16 words, one line, scroll-stopping
✅ A HOOK — make the user wonder "ye kya hua?" / "main kyun na dekhun?"
✅ Specific to TODAY's actual development if you can tell from the data
✅ Conversational — like a friend telling you something juicy, not a news anchor
✅ Curiosity-gap: hint at the story, don't summarise it

It must NOT be:
❌ A summary of what the topic is ("इस विषय पर पूरी जानकारी")
❌ A robotic invite ("जानिए...", "देखें...", "पढ़ें...", "यह ट्रेंड कर रहा है")
❌ A meta-description ("यह टैग में आपको posts और videos मिलेंगे")
❌ Clickbait that lies — must be true to the actual signal
❌ A literal translation of the English headline
❌ Bullet-style multi-clause stuff. One sentence, one beat.

GOOD descriptions (study the rhythm):
• "आज ये नाम हर जगह क्यों दिख रहा है?"
• "एक छोटी सी बात, और इंटरनेट अटक गया"
• "पुरानी यादें फिर से ट्रेंड में लौट आईं"
• "लोग इसे मज़ाक समझ रहे थे, फिर कहानी बदल गई"
• "ये सिर्फ खबर नहीं, पूरा मूड बन चुका है"
• "बस एक over और match का रंग बदल गया"
• "उत्तर भारत में पारा 45 के पार — लोग पूछ रहे हैं अब क्या"
• "एक बयान, और राजनीति का तापमान चढ़ गया"

BAD descriptions (do not produce these):
• "इस विषय के बारे में पूरी जानकारी पढ़ें"
• "यह विषय सोशल मीडिया पर ट्रेंड कर रहा है"
• "आज के दिन इससे जुड़ी जानकारी जानें"
• "इस टैग में आपको वीडियो और खबरें मिलेंगी"
• "पूरे देश में लोग मना रहे हैं" (generic festival template — banned)
• "खिलाड़ियों का प्रदर्शन और मैचों से जुड़ी ताज़ा जानकारी" (generic cricket template — banned)

═══════════════════════════════════════════════════════════════
OTHER RULES
═══════════════════════════════════════════════════════════════

- displayName: short, natural Devanagari name. Not a sentence. Not all-caps English. Examples: "बुद्ध पूर्णिमा", "IPL का रोमांच", "बंगाल चुनाव".
- tag: English hashtag, PascalCase or camelCase, no spaces, must start with #. Example: "#IPL2026", "#BengalElections".
- category: pick the closest single category. If unclear → "other".
- indiaRelevanceScore:
   - 1.0 if it's about India (Indian cricket, Hindi-belt politics, Indian weather event, Bollywood, Indian festival)
   - 0.9 for major Indian-context entertainment / pan-India news
   - 0.7 for global news that genuinely matters to Indians (oil prices, India-relevant geopolitics)
   - 0.6 minimum threshold — anything below this, drop it
- mentionedInSources: only list sources where this topic actually appeared in the input. Don't fabricate.
- Topics that are obviously regional-only to a non-Hindi state (e.g. a Kerala-only or Tamil Nadu-only event) should still be included if genuinely trending nationally, but write the description from the perspective of a Hindi-belt reader who is encountering it.

Return ONLY the JSON array. No preamble. No explanation. No markdown fences. No trailing commas.`;

export interface ExtractionResult {
  topics: ExtractedTopic[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractTopics(raw: RawInput): Promise<ExtractionResult> {
  const client = getOpenAI();
  const rawData = renderRawData(raw);

  // OpenAI chat completions: stable instructions in the `system` message,
  // volatile per-call data in the `user` message. The SDK's built-in retry
  // (default max_retries=2) handles 429/5xx with exponential backoff.
  const response = await client.chat.completions.create({
    model: MODELS.extraction,
    max_tokens: 8000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is the collected data from the last ~30 minutes:\n\n${rawData}\n\nReturn the JSON array now.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("OpenAI extraction returned no text");
  }

  const topics = parseAndValidate(text);

  return {
    topics,
    model: response.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

// Renders the raw signal data as a labeled, scannable block. Labels matter —
// they're how the model figures out what to put in `mentionedInSources`.
// The order isn't random: search intent first, then viral, then social
// discussion, then breaking news. This nudges the model to think of
// search-intent topics as the primary signal when present.
function renderRawData(raw: RawInput): string {
  const sections: string[] = [];

  if (raw.google_trends.length > 0) {
    sections.push(
      `## SOURCE: google_trends (${raw.google_trends.length} rising searches in India — direct search intent)`
    );
    raw.google_trends.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.youtube.length > 0) {
    sections.push(
      `## SOURCE: youtube (${raw.youtube.length} trending video titles in India — viral/social proxy)`
    );
    raw.youtube.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.reddit_india.length > 0) {
    sections.push(
      `## SOURCE: reddit_india (${raw.reddit_india.length} hot posts on r/india — national social discussion)`
    );
    raw.reddit_india.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.reddit_cricket.length > 0) {
    sections.push(
      `## SOURCE: reddit_cricket (${raw.reddit_cricket.length} hot posts on r/cricket — cricket fan discussion)`
    );
    raw.reddit_cricket.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.reddit_bollywood.length > 0) {
    sections.push(
      `## SOURCE: reddit_bollywood (${raw.reddit_bollywood.length} hot posts on r/bollywood — film/entertainment discussion)`
    );
    raw.reddit_bollywood.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.newsapi.length > 0) {
    sections.push(
      `## SOURCE: newsapi (${raw.newsapi.length} mainstream headlines — breaking news)`
    );
    raw.newsapi.forEach((t, i) => sections.push(`${i + 1}. ${t}`));
    sections.push("");
  }

  if (raw.rss.length > 0) {
    sections.push(
      `## SOURCE: rss (${raw.rss.length} headlines from Indian news RSS — breaking news)`
    );
    raw.rss.forEach((it, i) => sections.push(`${i + 1}. [${it.source}] ${it.title}`));
    sections.push("");
  }

  return sections.join("\n");
}

// Parses the model's JSON output and validates each entry. The prompt asks
// for "no markdown fences" but we strip them anyway in case the model
// drifts — paranoia is cheaper than a 500.
function parseAndValidate(text: string): ExtractedTopic[] {
  const cleaned = stripFences(text).trim();

  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    // Last-ditch: find the first '[' and the last ']' and try the slice.
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("OpenAI did not return parseable JSON");
    }
    arr = JSON.parse(cleaned.slice(start, end + 1));
  }

  if (!Array.isArray(arr)) throw new Error("OpenAI output is not a JSON array");

  const out: ExtractedTopic[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;

    const tag = typeof t.tag === "string" ? ensureHash(t.tag) : null;
    const displayName = typeof t.displayName === "string" ? t.displayName.trim() : null;
    const description = typeof t.description === "string" ? t.description.trim() : null;
    const category = ALLOWED_CATEGORIES.includes(t.category as Category)
      ? (t.category as Category)
      : "other";
    const emoji = typeof t.emoji === "string" && t.emoji.trim() ? t.emoji.trim() : "🔥";
    const indiaRelevanceScore =
      typeof t.indiaRelevanceScore === "number"
        ? Math.max(0, Math.min(1, t.indiaRelevanceScore))
        : 0.5;
    const mentionedInSources = Array.isArray(t.mentionedInSources)
      ? (t.mentionedInSources.filter((s) =>
          ALLOWED_SOURCES.includes(s as SourceName)
        ) as SourceName[])
      : [];

    if (!tag || !displayName || !description) continue;
    // Spec rule: skip topics with relevance below 0.6.
    if (indiaRelevanceScore < 0.6) continue;

    out.push({
      tag,
      displayName,
      description,
      category,
      emoji,
      indiaRelevanceScore,
      mentionedInSources,
    });
  }
  return out;
}

const ALLOWED_CATEGORIES: Category[] = [
  "cricket",
  "entertainment",
  "politics",
  "weather",
  "festival",
  "finance",
  "tech",
  "other",
];
const ALLOWED_SOURCES: SourceName[] = [
  "newsapi",
  "rss",
  "youtube",
  "google_trends",
  "reddit_india",
  "reddit_cricket",
  "reddit_bollywood",
];

function ensureHash(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, "");
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function stripFences(s: string): string {
  // Remove ```json … ``` or ``` … ``` fences if the model added them.
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}
