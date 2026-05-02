import type { ExtractedTopic, SourceName } from "../types";

// Post-extraction defensive clustering. the model is already told to merge
// near-duplicates, but it occasionally returns two near-identical tags
// (e.g. "#TeamIndia" + "#IndianCricketTeam"). We collapse these by
// normalizing the tag — strip punctuation, lowercase, ignore length-1
// suffixes — and merging their `mentionedInSources` arrays.

export function clusterTopics(topics: ExtractedTopic[]): ExtractedTopic[] {
  const buckets = new Map<string, ExtractedTopic>();

  for (const topic of topics) {
    const key = normalize(topic.tag);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...topic });
      continue;
    }
    // Merge: prefer the higher-relevance topic as the canonical entry,
    // but take the union of sources from both.
    const winner =
      topic.indiaRelevanceScore > existing.indiaRelevanceScore ? topic : existing;
    const loser = winner === topic ? existing : topic;
    buckets.set(key, {
      ...winner,
      mentionedInSources: unionSources(
        winner.mentionedInSources,
        loser.mentionedInSources
      ),
      // If the loser had a richer description, keep the longer of the
      // two — sometimes the model duplicates with one short and one full.
      description:
        winner.description.length >= loser.description.length
          ? winner.description
          : loser.description,
    });
  }

  return Array.from(buckets.values());
}

function normalize(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\d{4}$/, ""); // drop trailing year so "#IPL2026" == "#IPL"
}

function unionSources(a: SourceName[], b: SourceName[]): SourceName[] {
  const set = new Set<SourceName>([...a, ...b]);
  return Array.from(set);
}
