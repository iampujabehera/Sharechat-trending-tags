import OpenAI from "openai";

// Single shared OpenAI client. Initialised lazily so the module loads
// even when OPENAI_API_KEY is absent at build time — callers see the
// failure when they actually try to send a request.
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local for local dev or to the Vercel project's Environment Variables in production. Get a key at https://platform.openai.com/api-keys."
    );
  }
  client = new OpenAI({ apiKey });
  return client;
}

// Centralized model ids. Default to gpt-4o-mini for both extraction and
// summary — the cheapest current OpenAI model that still handles Hindi
// extraction well. ~20x cheaper than gpt-4o, ~5x cheaper than Claude Opus.
// Override per call site via env vars if you want to swap to gpt-4o for
// higher quality.
export const MODELS = {
  extraction: process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4o-mini",
  summary: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4o-mini",
} as const;

// OpenAI SDK retries 429/5xx automatically with exponential backoff
// (default max_retries=2). We don't need a manual model-fallback chain.
// Transient errors auto-retry; on hard failure the caller's existing
// static-fallback path (public/fallback-trends.json) takes over.
