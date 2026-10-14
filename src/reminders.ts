import { todayIso } from "./dates.ts";
import { postMessage } from "./discord/api.ts";
import type { Env, Mode } from "./types.ts";

/** Days before the key date (start for on-site, submission deadline for online) to ping. */
const REMIND_AT_DAYS = [7, 1];

interface Due {
  id: number;
  title: string;
  url: string;
  mode: Mode;
  user_id: string;
  days: number;
}

export async function runReminders(env: Env, channelId: string, today = todayIso()) {
  const due = (
    await env.DB.prepare(
      `WITH t AS (
         SELECT e.id, e.title, e.url, e.mode, i.user_id,
                CAST(julianday(CASE WHEN e.mode = 'online' THEN e.end_date ELSE e.start_date END)
                     - julianday(?1) AS INTEGER) AS days
         FROM interest i JOIN events e ON e.id = i.event_id
         WHERE i.remind = 1 AND e.removed_at IS NULL
       )
       SELECT * FROM t
       WHERE days IN (${REMIND_AT_DAYS.join(", ")})
         AND NOT EXISTS (SELECT 1 FROM reminders_sent r
                         WHERE r.event_id = t.id AND r.user_id = t.user_id AND r.kind = t.days || 'd')`,
    )
      .bind(today)
      .all<Due>()
  ).results;

  // One message per event, mentioning everyone who asked.
  const groups = new Map<string, Due[]>();
  for (const d of due) groups.set(`${d.id}:${d.days}`, [...(groups.get(`${d.id}:${d.days}`) ?? []), d]);

  const sent: D1PreparedStatement[] = [];
  for (const rows of groups.values()) {
    const { id, title, url, mode, days } = rows[0];
    const users = rows.map((r) => r.user_id);
    const what = mode === "online" ? "submissions close" : "starts";
    try {
      await postMessage(env, channelId, {
        content: `⏰ ${users.map((u) => `<@${u}>`).join(" ")} **[${title}](<${url}>)** ${what} in **${days === 1 ? "1 day" : `${days} days`}**.`,
        allowed_mentions: { users },
      });
      for (const u of users) {
        sent.push(
          env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (event_id, user_id, kind) VALUES (?, ?, ?)").bind(id, u, `${days}d`),
        );
      }
    } catch (err) {
      console.error(`reminder for event ${id} failed`, err);
    }
  }
  if (sent.length) await env.DB.batch(sent);
  return { reminders: groups.size };
}
