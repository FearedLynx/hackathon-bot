import { classify, dedupeEvents, dedupeKey, isSameEvent } from "./classify.ts";
import { formatRange, todayIso } from "./dates.ts";
import { postMessage } from "./discord/api.ts";
import { CATEGORY_LABEL, eventButtons, eventEmbed } from "./discord/embeds.ts";
import { checkEventPage } from "./details/check.ts";
import { removedView, syncPost } from "./removal.ts";
import { updateFlagships, type Settings } from "./settings.ts";
import { fetchAllSources } from "./sources/index.ts";
import { feedsForRun } from "./sources/luma.ts";
import type { Category, Env, EventRow, RawEvent } from "./types.ts";

/** Cap per run so a burst of new events doesn't flood the channel; the rest go out next run. */
const MAX_POSTS_PER_RUN = 8;
const MAX_CHANGE_NOTICES_PER_RUN = 3;
const MAX_PAGE_CHECKS_PER_RUN = 8;
/** Sources whose event pages we read before announcing (see details/check.ts). */
const CHECKED_SOURCES = "('devpost', 'luma')";

type Known = Pick<
  EventRow,
  "id" | "source_key" | "dedupe_key" | "start_date" | "end_date" | "fingerprint" | "posted_at" | "removed_at"
>;

const fingerprint = (e: RawEvent, category: Category) =>
  JSON.stringify([e.title, e.url, e.start, e.end, e.location, e.country, e.mode, e.prize, e.teamSize, category, e.themes, e.regStatus ?? null]);

export async function runIngest(env: Env, settings: Settings, today = todayIso()) {
  const hourIndex = Math.floor(Date.now() / 3_600_000);
  const { events, errors } = await fetchAllSources(feedsForRun(settings.lumaFeeds, hourIndex), today);
  for (const err of errors) console.error(`source failed: ${err}`);

  const known = (
    await env.DB.prepare(
      "SELECT id, source_key, dedupe_key, start_date, end_date, fingerprint, posted_at, removed_at FROM events",
    ).all<Known>()
  ).results;
  const wasEmpty = known.length === 0;
  const byKey = new Map(known.map((k) => [k.source_key, k]));

  const writes: D1PreparedStatement[] = [];
  const dateChanges: { category: Category; title: string; url: string; was: string; now: string }[] = [];
  let added = 0;

  for (const e of dedupeEvents(events)) {
    const category = classify(e);
    if (!category || e.end < today) continue;
    const key = `${e.source}:${e.sourceId}`;
    const dk = dedupeKey(e.title);
    const fp = fingerprint(e, category);
    const values = [e.title, dk, e.url, e.sourceUrl, e.start, e.end, e.location, e.country, e.mode, category, e.prize, e.teamSize, e.themes.join(", ") || null, e.regStatus ?? null, e.regDeadline ?? null, fp];
    const existing = byKey.get(key);

    if (!existing) {
      // Same event already stored from another source.
      const same = known.find((k) => isSameEvent(k.dedupe_key, k.start_date, dk, e.start));
      if (same) {
        // A flagship's own website knows more (prize, deadline, team size): fill those in.
        if (e.source === "site" && same.id) {
          writes.push(
            env.DB.prepare(
              `UPDATE events SET reg_deadline = COALESCE(?, reg_deadline), team_size = COALESCE(?, team_size),
                 prize_detail = COALESCE(?, prize_detail) WHERE id = ?`,
            ).bind(e.regDeadline ?? null, e.teamSize, e.prize, same.id),
          );
        }
        continue;
      }
      writes.push(
        env.DB.prepare(
          `INSERT INTO events (source_key, source, title, dedupe_key, url, source_url, start_date, end_date,
             location, country, mode, category, prize, team_size, themes, reg_status, reg_deadline, fingerprint, deadline_checked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(key, e.source, ...values, e.source === "devpost" || e.source === "luma" ? 0 : 1),
      );
      known.push({ id: 0, source_key: key, dedupe_key: dk, start_date: e.start, end_date: e.end, fingerprint: fp, posted_at: null, removed_at: null });
      added++;
    } else if (existing.fingerprint !== fp) {
      writes.push(
        env.DB.prepare(
          `UPDATE events SET title = ?, dedupe_key = ?, url = ?, source_url = ?, start_date = ?, end_date = ?,
             location = ?, country = ?, mode = ?, category = ?, prize = ?, team_size = COALESCE(?, team_size), themes = ?,
             reg_status = ?, reg_deadline = COALESCE(?, reg_deadline), fingerprint = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).bind(...values, existing.id),
      );
      if (existing.end_date !== e.end) {
        // Deadline may have moved with the dates; look it up again.
        writes.push(env.DB.prepare("UPDATE events SET deadline_checked = 0 WHERE id = ?").bind(existing.id));
      }
      if (existing.posted_at && !existing.removed_at && (existing.start_date !== e.start || existing.end_date !== e.end)) {
        dateChanges.push({
          category,
          title: e.title,
          url: e.url,
          was: formatRange(existing.start_date, existing.end_date),
          now: formatRange(e.start, e.end),
        });
      }
    }
  }
  if (writes.length) await env.DB.batch(writes);
  await updateFlagships(env, settings.flagships);
  const checked = await runPageChecks(env, settings, today);

  let posted = 0;
  if (wasEmpty) {
    // First run: don't dump everything into the channel, just announce.
    await env.DB.prepare("UPDATE events SET posted_at = datetime('now') WHERE posted_at IS NULL").run();
    const counts = (
      await env.DB.prepare("SELECT category, COUNT(*) AS n FROM events GROUP BY category").all<{ category: Category; n: number }>()
    ).results;
    const summary = counts.map((c) => `${CATEGORY_LABEL[c.category]}: **${c.n}**`).join(" · ");
    await postMessage(env, settings.channelId, {
      content:
        `👋 **Hackathon bot is live!** Tracking ${added} hackathons.\n${summary}\n\n` +
        "Browse with `/hackathons`, details and sources with `/hackathon`. Admins: `/config` sets when I post.",
    });
  } else {
    // Categories that are switched off are never announced, even if re-enabled later.
    const enabled = settings.categories;
    await env.DB.prepare(
      `UPDATE events SET posted_at = datetime('now') WHERE posted_at IS NULL
       ${enabled.length ? `AND category NOT IN (${enabled.map(() => "?").join(", ")})` : ""}`,
    )
      .bind(...enabled)
      .run();

    // In daily mode the digest announces pending events instead.
    const pending =
      settings.mode === "daily"
        ? []
        : (
            await env.DB.prepare(
              // Never announce an event before its page has been checked.
              `SELECT * FROM events WHERE posted_at IS NULL AND removed_at IS NULL AND end_date >= ?
               AND (deadline_checked = 1 OR source NOT IN ${CHECKED_SOURCES}) ORDER BY start_date LIMIT ?`,
            )
              .bind(today, MAX_POSTS_PER_RUN)
              .all<EventRow>()
          ).results;
    const marks: D1PreparedStatement[] = [];
    for (const e of pending) {
      try {
        const messageId = await postMessage(env, settings.channelId, {
          content: e.flagship ? "⭐ **Flagship hackathon**" : "🆕 New hackathon",
          embeds: [eventEmbed(e, env.PUBLIC_URL)],
          components: eventButtons(e, env.PUBLIC_URL),
        });
        marks.push(
          env.DB.prepare("UPDATE events SET posted_at = datetime('now'), message_id = ? WHERE id = ?").bind(messageId, e.id),
        );
        posted++;
      } catch (err) {
        console.error(`posting event ${e.id} failed`, err);
      }
    }
    if (marks.length) await env.DB.batch(marks);

    for (const c of dateChanges.filter((d) => enabled.includes(d.category)).slice(0, MAX_CHANGE_NOTICES_PER_RUN)) {
      await postMessage(env, settings.channelId, {
        content: `📅 **Date change:** [${c.title}](<${c.url}>) is now **${c.now}** (was ${c.was}).`,
      });
    }
  }

  return { fetched: events.length, added, updated: writes.length - added, ...checked, posted, dateChanges: dateChanges.length, errors };
}

/**
 * Reads each event's own page (prize, deadline, who can join, team size, on-site
 * signals) before it is announced, and removes events the team can't take part in,
 * with the reason. Capped per run to stay within the Workers subrequest limit.
 */
async function runPageChecks(env: Env, settings: Settings, today: string) {
  const todo = (
    await env.DB.prepare(
      `SELECT * FROM events WHERE source IN ${CHECKED_SOURCES} AND deadline_checked = 0 AND removed_at IS NULL AND end_date >= ?
       ORDER BY posted_at IS NOT NULL, start_date LIMIT ?`,
    )
      .bind(today, MAX_PAGE_CHECKS_PER_RUN)
      .all<EventRow>()
  ).results;
  const results = await Promise.allSettled(todo.map((e) => checkEventPage(e)));
  const updates: D1PreparedStatement[] = [];
  const removedPosts: number[] = [];
  results.forEach((r, i) => {
    const e = todo[i];
    // On fetch errors leave it unchecked so the next run retries.
    if (r.status === "rejected") return console.error(`page check for event ${e.id} failed`, r.reason);
    const c = r.value ?? {};
    updates.push(
      env.DB.prepare(
        `UPDATE events SET reg_deadline = COALESCE(?, reg_deadline), prize_detail = ?, team_size = COALESCE(?, team_size),
           eligibility = ?, verify_note = ?, deadline_checked = 1 WHERE id = ?`,
      ).bind(c.deadline ?? null, c.prize ?? null, c.teamSize ?? null, c.eligibility ?? null, c.note ?? null, e.id),
    );
    if (c.removeReason) {
      updates.push(
        env.DB.prepare(
          `UPDATE events SET removed_at = datetime('now'), removed_by = 'auto', removed_reason = ?,
             posted_at = COALESCE(posted_at, datetime('now')) WHERE id = ?`,
        ).bind(c.removeReason, e.id),
      );
      if (e.message_id) removedPosts.push(e.id);
    }
  });
  if (updates.length) await env.DB.batch(updates);

  // Already-posted events that turned out not to fit: update their post too.
  for (const id of removedPosts) {
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
    if (e) await syncPost(env, settings.channelId, e, removedView(e));
  }
  return { pagesChecked: updates.length ? results.filter((r) => r.status === "fulfilled").length : 0, autoRemoved: results.filter((r) => r.status === "fulfilled" && r.value?.removeReason).length };
}
