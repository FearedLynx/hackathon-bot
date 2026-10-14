import { editMessage, type MessageBody } from "./discord/api.ts";
import { eventButtons, eventEmbed } from "./discord/embeds.ts";
import type { Env, EventRow } from "./types.ts";

// Anyone in the server can remove a hackathon that doesn't fit the team (e.g. high-school
// only) with a reason. Removed events stay in the database so the next fetch doesn't
// re-add them, but they're hidden from lists, digests, reminders and posts.

export const REASON_MAX = 400;

/** Pop-up asking why. `origin` is "msg" when opened from a post's button. */
export function removeModal(e: Pick<EventRow, "id" | "title">, origin: "msg" | "cmd") {
  const title = `Remove: ${e.title}`;
  return {
    type: 9, // MODAL
    data: {
      custom_id: `rmvmodal:${e.id}:${origin}`,
      title: title.length > 45 ? title.slice(0, 44) + "…" : title,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // TEXT_INPUT
              custom_id: "reason",
              style: 2, // paragraph
              label: "Why remove it?",
              placeholder: "e.g. Only for high-school students",
              min_length: 3,
              max_length: REASON_MAX,
              required: true,
            },
          ],
        },
      ],
    },
  };
}

/** The post after removal: who, when, and the reason as a spoiler (collapsed until clicked). */
export function removedView(e: EventRow): MessageBody {
  const when = e.removed_at ? `<t:${Math.floor(Date.parse(e.removed_at.replace(" ", "T") + "Z") / 1000)}:R>` : "";
  const who = e.removed_by === "auto" ? "🤖 **Auto-removed** after checking the event page" : `🗑️ **Removed** by <@${e.removed_by}>`;
  return {
    content: `${who} ${when}`,
    embeds: [
      {
        title: e.title.length > 256 ? e.title.slice(0, 255) + "…" : e.title,
        url: e.url,
        color: 0x4f545c,
        description: `**Reason** – click to reveal:\n||${(e.removed_reason ?? "").replace(/\|/g, "∣")}||`,
        footer: { text: "Hidden from lists, digests and reminders · Restore to undo" },
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 2, label: "Restore", emoji: { name: "♻️" }, custom_id: `rst:${e.id}` }],
      },
    ],
  };
}

export function activeView(e: EventRow, baseUrl: string, note?: string): MessageBody {
  return { content: note ?? "🆕 New hackathon", embeds: [eventEmbed(e, baseUrl)], components: eventButtons(e, baseUrl) };
}

export async function removeEvent(env: Env, id: number, userId: string, reason: string): Promise<EventRow | null> {
  await env.DB.prepare(
    "UPDATE events SET removed_at = datetime('now'), removed_by = ?, removed_reason = ?, posted_at = COALESCE(posted_at, datetime('now')) WHERE id = ?",
  )
    .bind(userId, reason.trim().slice(0, REASON_MAX), id)
    .run();
  return env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
}

export async function restoreEvent(env: Env, id: number): Promise<EventRow | null> {
  await env.DB.prepare("UPDATE events SET removed_at = NULL, removed_by = NULL, removed_reason = NULL WHERE id = ?").bind(id).run();
  return env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
}

/** Updates the bot's original post for this event (used when the change came from a slash command). */
export async function syncPost(env: Env, channelId: string, e: EventRow, body: MessageBody) {
  if (!e.message_id) return;
  try {
    await editMessage(env, channelId, e.message_id, body);
  } catch (err) {
    console.error(`couldn't update post for event ${e.id}`, err);
  }
}
