import { postMessage, type MessageBody } from "./discord/api.ts";
import { listEmbed } from "./discord/embeds.ts";
import type { Settings } from "./settings.ts";
import type { Env, EventRow } from "./types.ts";

const LIST_LIMIT = 10;
const UPCOMING_DAYS = 7;

/**
 * SQL filters for the digest. Bind with (today, ...settings.categories):
 * ?1 is today, ?2.. are the enabled categories.
 */
function filters(s: Settings) {
  const cats = s.categories.length
    ? `category IN (${s.categories.map((_, i) => `?${i + 2}`).join(", ")})`
    : "0";
  // "New" = not yet announced (daily mode), or first seen in the last 24h when
  // instant posts already announced it (mode "both").
  const fresh =
    s.mode === "daily"
      ? `posted_at IS NULL AND removed_at IS NULL AND end_date >= ?1 AND ${cats}`
      : `first_seen >= datetime('now', '-1 day') AND removed_at IS NULL AND end_date >= ?1 AND ${cats}`;
  const upcoming = `removed_at IS NULL AND start_date >= ?1 AND start_date <= date(?1, '+${UPCOMING_DAYS} days') AND ${cats}`;
  return { fresh, upcoming };
}

async function buildDigest(env: Env, s: Settings, today: string): Promise<MessageBody> {
  const f = filters(s);
  const q = (sql: string) => env.DB.prepare(sql).bind(today, ...s.categories);
  const [fresh, freshCount, upcoming] = await Promise.all([
    q(`SELECT * FROM events WHERE ${f.fresh} ORDER BY start_date LIMIT ${LIST_LIMIT}`).all<EventRow>(),
    q(`SELECT COUNT(*) AS n FROM events WHERE ${f.fresh}`).first<{ n: number }>(),
    q(`SELECT * FROM events WHERE ${f.upcoming} ORDER BY start_date LIMIT ${LIST_LIMIT}`).all<EventRow>(),
  ]);
  const n = freshCount?.n ?? 0;
  return {
    content: `☀️ **Daily hackathon update** · ${today}`,
    embeds: [
      listEmbed(`🆕 New hackathons (${n})`, fresh.results, {
        baseUrl: env.PUBLIC_URL,
        footer: n > LIST_LIMIT ? `+${n - LIST_LIMIT} more · /hackathons to see all` : undefined,
        emptyText: "No new hackathons since the last update.",
      }),
      listEmbed(`📅 Starting in the next ${UPCOMING_DAYS} days`, upcoming.results, {
        baseUrl: env.PUBLIC_URL,
        emptyText: "Nothing starts this week.",
      }),
    ],
  };
}

/** Digest for /config preview; nothing is marked as announced. */
export const previewDigest = buildDigest;

export async function runDigest(env: Env, s: Settings, today: string) {
  await postMessage(env, s.channelId, await buildDigest(env, s, today));
  if (s.mode === "daily") {
    await env.DB.prepare(`UPDATE events SET posted_at = datetime('now') WHERE ${filters(s).fresh}`)
      .bind(today, ...s.categories)
      .run();
  }
}
