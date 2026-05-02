import type { CalendarEvent } from "../types";
import calendar from "../../data/cultural-calendar.json";

// The shape stored on disk (raw JSON):
interface RawCalendarEvent {
  name: string;
  hindiName: string;
  date: string; // YYYY-MM-DD
  category: string;
  relevantRegions: string[];
  boostDaysBefore: number;
  emoji: string;
}

interface RawCalendar {
  events: RawCalendarEvent[];
}

const raw = calendar as unknown as RawCalendar;

// Returns events that should be "boosted" right now: their date is within
// the next 7 days OR within their declared `boostDaysBefore` window. The
// `boostScore` is 1.0 on the day-of, 0.8 one day before, 0.6 two days
// before, etc., decaying linearly.
//
// We also return events that ended within the last 1 day, since people
// keep posting about them the morning after.
export function getUpcomingCalendarBoosts(now: Date = new Date()): CalendarEvent[] {
  const today = startOfDayUTC(now);
  const out: CalendarEvent[] = [];

  for (const e of raw.events) {
    const eventDay = parseISODate(e.date);
    if (!eventDay) continue;

    const daysUntil = daysBetween(today, eventDay);
    // Lookahead window: at least 14 days regardless of boostDaysBefore.
    // Original logic min-clamped to 5, which made the "आज का दिन" strip
    // sparse — only events 0-2 days out would surface. 14 days lets the
    // strip show meaningful upcoming context (Mother's Day a week away,
    // an IPL playoff in 10 days, a long-anticipated festival).
    const window = Math.max(e.boostDaysBefore ?? 7, 14);

    // Out of window — skip
    if (daysUntil > window) continue;
    if (daysUntil < -1) continue; // more than 1 day past

    const boostScore = computeBoostScore(daysUntil, window);

    out.push({
      name: e.name,
      hindiName: e.hindiName,
      date: e.date,
      category: e.category as CalendarEvent["category"],
      relevantRegions: e.relevantRegions,
      boostDaysBefore: e.boostDaysBefore,
      emoji: e.emoji,
      boostScore,
    });
  }

  // Highest boost first.
  out.sort((a, b) => (b.boostScore ?? 0) - (a.boostScore ?? 0));
  return out;
}

// 1.0 on day-of, 0.8 one day before, decays linearly across the window.
// Yesterday gets 0.4 (people are still posting that morning).
function computeBoostScore(daysUntil: number, window: number): number {
  if (daysUntil < 0) return 0.4;
  if (daysUntil === 0) return 1.0;
  // Linear from 1.0 (today) → 0.2 (edge of window).
  const ratio = 1 - daysUntil / Math.max(window, 1);
  return Math.max(0.2, +ratio.toFixed(2));
}

function parseISODate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
