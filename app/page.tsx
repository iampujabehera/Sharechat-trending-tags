import { headers } from "next/headers";
import type { TrendingResponse } from "@/lib/types";
import TrendingApp from "@/components/TrendingApp";

// Page itself is dynamic — we always want fresh data on hard refresh.
// (The /api/trending route handles its own 25-min caching.)
export const dynamic = "force-dynamic";

async function loadTrending(): Promise<{
  data?: TrendingResponse;
  error?: string;
}> {
  // Derive the base URL from the actual incoming request rather than
  // hard-coding a port — works on whatever port `next dev` chose, and
  // on Vercel's preview/production hosts.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? `${proto}://${host}`;
  try {
    const res = await fetch(`${base}/api/trending`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      return { error: `API ${res.status}: ${body.slice(0, 200)}` };
    }
    return { data: (await res.json()) as TrendingResponse };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function Page() {
  const { data, error } = await loadTrending();
  return <TrendingApp initialData={data} initialError={error} />;
}
