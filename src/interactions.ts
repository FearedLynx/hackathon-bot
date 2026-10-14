import { canConfigure, handleConfig } from "./config-command.ts";
import { todayIso } from "./dates.ts";
import { cashValueEur, formatEur } from "./details/prize-value.ts";
import { CATEGORY_LABEL, listEmbed, prizeOf, sourcesText } from "./discord/embeds.ts";
import { activeView, removedView, removeEvent, removeModal, restoreEvent, syncPost } from "./removal.ts";
import { getSettings } from "./settings.ts";
import type { Category, Env, EventRow } from "./types.ts";

interface Option {
  name: string;
  value?: string | number | boolean;
  focused?: boolean;
  options?: Option[];
}

interface ModalComponent {
  type: number;
  custom_id?: string;
  value?: string;
  components?: ModalComponent[];
  component?: ModalComponent;
}

export interface Interaction {
  type: number;
  data?: { name?: string; options?: Option[]; custom_id?: string; components?: ModalComponent[] };
  member?: { user: { id: string }; permissions?: string };
  user?: { id: string };
  message?: { id: string; channel_id: string };
}

const InteractionType = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 } as const;
const EPHEMERAL = 64;
const LIST_LIMIT = 10;
/** Removed hackathons are hidden from every list. */
const ACTIVE = "removed_at IS NULL";

const reply = (data: Record<string, unknown>, ephemeral = false) =>
  Response.json({
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { ...data, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } },
  });

/** Replaces the message the button was on. */
const updateMessage = (data: Record<string, unknown>) => Response.json({ type: 7, data });

const option = (i: Interaction, name: string) => i.data?.options?.find((o) => o.name === name)?.value;
const userId = (i: Interaction) => i.member?.user.id ?? i.user?.id ?? "";

/** Finds a text input's value in a modal submit (works for both legacy rows and label components). */
function modalValue(components: ModalComponent[] | undefined, id: string): string | undefined {
  for (const c of components ?? []) {
    if (c.custom_id === id && typeof c.value === "string") return c.value;
    const nested = modalValue([...(c.components ?? []), ...(c.component ? [c.component] : [])], id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export async function handleInteraction(i: Interaction, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    switch (i.type) {
      case InteractionType.PING:
        return Response.json({ type: 1 });
      case InteractionType.COMMAND:
        if (i.data?.name === "config") {
          if (!canConfigure(i.member?.permissions)) {
            return reply({ content: "You need the **Manage Server** permission to change settings." }, true);
          }
          return reply(await handleConfig(i.data.options?.[0], env, ctx), true);
        }
        return await handleCommand(i, env, ctx);
      case InteractionType.COMPONENT:
        return await handleComponent(i, env);
      case InteractionType.AUTOCOMPLETE:
        return await handleAutocomplete(i, env);
      case InteractionType.MODAL_SUBMIT:
        return await handleModal(i, env, ctx);
    }
  } catch (err) {
    console.error("interaction failed", err);
    return reply({ content: "Something went wrong, try again in a moment." }, true);
  }
  return new Response("Unknown interaction", { status: 400 });
}

async function findEvent(env: Env, query: string): Promise<EventRow | null> {
  if (/^\d+$/.test(query)) {
    const byId = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(Number(query)).first<EventRow>();
    if (byId) return byId;
  }
  return env.DB.prepare(
    "SELECT * FROM events WHERE title LIKE ? ORDER BY removed_at IS NULL DESC, end_date >= date('now') DESC, start_date LIMIT 1",
  )
    .bind(`%${query}%`)
    .first<EventRow>();
}

async function handleCommand(i: Interaction, env: Env, ctx: ExecutionContext): Promise<Response> {
  const today = todayIso();

  switch (i.data?.name) {
    case "hackathons": {
      const category = (option(i, "category") as string | undefined) ?? "all";
      const sort = (option(i, "sort") as SortKey | undefined) ?? "date";
      const days = Number(option(i, "within_days") ?? (sort === "prize" ? 365 : 60));
      if (category === "removed") return reply({ embeds: [await removedList(env, today)] }, true);
      return reply(await hackathonsPage(env, { category, days, sort, page: 0 }));
    }

    case "hackathon": {
      const query = String(option(i, "name") ?? "");
      const e = await findEvent(env, query);
      if (!e) return reply({ content: `No hackathon matching “${query}”.` }, true);
      const action = String(option(i, "action") ?? "show");

      if (action === "remove") {
        if (e.removed_at) return reply({ content: `**${e.title}** is already removed.` }, true);
        const reason = String(option(i, "reason") ?? "").trim();
        if (reason.length < 3) return Response.json(removeModal(e, "cmd"));
        return reply(await applyRemoval(env, ctx, e.id, userId(i), reason));
      }
      if (action === "restore") {
        if (!e.removed_at) return reply({ content: `**${e.title}** isn't removed.` }, true);
        return reply(await applyRestore(env, ctx, e.id, userId(i)));
      }
      if (e.removed_at) return reply({ ...removedView(e) });
      const view = activeView(e, env.PUBLIC_URL, `**Sources**\n${sourcesText(e)}`);
      return reply({ ...view });
    }

    case "interested": {
      const rows = await env.DB.prepare(
        `SELECT e.*, i.remind FROM interest i JOIN events e ON e.id = i.event_id
         WHERE i.user_id = ? AND e.end_date >= ? AND e.${ACTIVE} ORDER BY e.start_date LIMIT 25`,
      )
        .bind(userId(i), today)
        .all<EventRow & { remind: number }>();
      if (!rows.results.length) {
        return reply({ content: "You haven't marked any hackathons yet. Press ✅ Interested on a post." }, true);
      }
      return reply(
        { embeds: [listEmbed("Your hackathons", rows.results, { baseUrl: env.PUBLIC_URL, footer: "⏰ = reminders on" })] },
        true,
      );
    }
  }
  return reply({ content: "Unknown command." }, true);
}

type SortKey = "date" | "prize" | "deadline";

interface ListQuery {
  category: string;
  days: number;
  sort: SortKey;
  page: number;
}

/** Button id carrying the whole query, so paging needs no stored state: "pg:<page>:<cat>:<days>:<sort>:<p|n>". */
export const pageButtonId = (q: ListQuery, dir: "p" | "n") => `pg:${q.page}:${q.category}:${q.days}:${q.sort}:${dir}`;

export function parsePageButton(customId: string): ListQuery | null {
  const [kind, page, category, days, sort] = customId.split(":");
  if (kind !== "pg" || !category || !["date", "prize", "deadline"].includes(sort)) return null;
  return { page: Math.max(0, Number(page) || 0), category, days: Number(days) || 60, sort: sort as SortKey };
}

/** One page of /hackathons, with ◀ / ▶ buttons when there's more than one page. */
async function hackathonsPage(env: Env, q: ListQuery) {
  const today = todayIso();
  const filter = q.category === "all" ? "" : q.category === "flagship" ? " AND flagship = 1" : " AND category = ?3";
  const where = `${ACTIVE} AND end_date >= ?1 AND start_date <= date(?1, '+' || ?2 || ' days')${filter}`;
  const params = filter.includes("?3") ? [today, q.days, q.category] : [today, q.days];
  // At most a few hundred rows, so sort in code (prizes are text in mixed currencies).
  const all = (await env.DB.prepare(`SELECT * FROM events WHERE ${where} ORDER BY start_date`).bind(...params).all<EventRow>()).results;
  const sorted = sortEvents(all, q.sort);
  const n = sorted.length;
  const pages = Math.max(1, Math.ceil(n / LIST_LIMIT));
  const page = Math.min(q.page, pages - 1); // the list may have shrunk since the button was made
  const from = page * LIST_LIMIT;
  const label =
    q.category === "all" ? "All hackathons" : q.category === "flagship" ? "⭐ Flagship hackathons" : CATEGORY_LABEL[q.category as Category];
  const sortTitle = q.sort === "prize" ? " · 🏆 by prize" : q.sort === "deadline" ? " · ⏳ by deadline" : "";
  const sortNote =
    q.sort === "prize" ? "Sorted by cash prize (≈ EUR, non-cash = 0)" : q.sort === "deadline" ? "Sorted by registration deadline" : "/hackathon <name> for details & sources";
  const range = n === 0 ? "0 found" : pages > 1 ? `Page ${page + 1}/${pages} · showing ${from + 1}–${Math.min(from + LIST_LIMIT, n)} of ${n}` : `${n} found`;
  const at = { ...q, page };
  return {
    embeds: [
      listEmbed(`${label} · next ${q.days} days${sortTitle}`, sorted.slice(from, from + LIST_LIMIT), {
        baseUrl: env.PUBLIC_URL,
        footer: `${range} · ${sortNote}`,
        extra: q.sort === "prize" ? eurHint : undefined,
      }),
    ],
    components:
      pages > 1
        ? [
            {
              type: 1,
              components: [
                { type: 2, style: 2, label: "Previous", emoji: { name: "◀️" }, custom_id: pageButtonId({ ...at, page: page - 1 }, "p"), disabled: page === 0 },
                { type: 2, style: 2, label: `${page + 1} / ${pages}`, custom_id: "pg:noop", disabled: true },
                { type: 2, style: 1, label: "Next", emoji: { name: "▶️" }, custom_id: pageButtonId({ ...at, page: page + 1 }, "n"), disabled: page >= pages - 1 },
              ],
            },
          ]
        : [],
  };
}

/** Registration deadline, or the submission end for Devpost (registration closes with it). */
const effectiveDeadline = (e: EventRow) => e.reg_deadline ?? (e.source === "devpost" ? `${e.end_date}T23:59:59Z` : null);

export function sortEvents(rows: EventRow[], sort: SortKey): EventRow[] {
  if (sort === "prize") {
    // Highest cash first; ties (incl. all non-cash) keep date order.
    return rows
      .map((e, i) => ({ e, i, v: cashValueEur(prizeOf(e)) }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map((x) => x.e);
  }
  if (sort === "deadline") {
    return [...rows].sort((a, b) => {
      const [da, db] = [effectiveDeadline(a), effectiveDeadline(b)];
      if (da && db) return da.localeCompare(db);
      return da ? -1 : db ? 1 : a.start_date.localeCompare(b.start_date); // unknown deadlines last
    });
  }
  return rows;
}

/** "≈ €12k" next to non-euro prizes when sorting by prize. */
function eurHint(e: EventRow): string | null {
  const prize = prizeOf(e);
  const v = cashValueEur(prize);
  return v > 0 && !/^€/.test(prize ?? "") ? `≈ ${formatEur(v)}` : null;
}

/** Upcoming removed hackathons with who removed them and why (reasons behind spoilers). */
async function removedList(env: Env, today: string) {
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM events WHERE removed_at IS NOT NULL AND end_date >= ? ORDER BY removed_at DESC LIMIT 25",
    )
      .bind(today)
      .all<EventRow>()
  ).results;
  let description = "";
  for (const e of rows) {
    const who = e.removed_by === "auto" ? "🤖 auto" : `<@${e.removed_by}>`;
    const line = `**[${e.title.slice(0, 70)}](${e.url})** · ${who}\n||${(e.removed_reason ?? "").replace(/\|/g, "∣").slice(0, 200)}||`;
    if (description.length + line.length > 3900) break;
    description += (description ? "\n\n" : "") + line;
  }
  return {
    title: `🗑️ Removed hackathons (${rows.length})`,
    description: description || "Nothing removed.",
    color: 0x4f545c,
    footer: { text: "Click a reason to reveal it · /hackathon <name> action:Restore to bring one back" },
  };
}

/** Removes via slash command: confirms publicly and updates the original post, if any. */
async function applyRemoval(env: Env, ctx: ExecutionContext, id: number, user: string, reason: string) {
  const e = (await removeEvent(env, id, user, reason))!;
  const view = removedView(e);
  ctx.waitUntil(getSettings(env).then((s) => syncPost(env, s.channelId, e, view)));
  return { ...view };
}

async function applyRestore(env: Env, ctx: ExecutionContext, id: number, user: string) {
  const e = (await restoreEvent(env, id))!;
  const view = activeView(e, env.PUBLIC_URL, `♻️ Restored by <@${user}>`);
  ctx.waitUntil(getSettings(env).then((s) => syncPost(env, s.channelId, e, view)));
  return { ...view };
}

async function handleComponent(i: Interaction, env: Env): Promise<Response> {
  // ◀ / ▶ on a /hackathons list: redraw the same message with the other page.
  const pageQuery = parsePageButton(i.data?.custom_id ?? "");
  if (pageQuery) return updateMessage(await hackathonsPage(env, pageQuery));

  const [action, idStr] = (i.data?.custom_id ?? "").split(":");
  const id = Number(idStr);
  const user = userId(i);
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!e) return reply({ content: "This hackathon is no longer tracked." }, true);

  switch (action) {
    case "rmv":
      if (e.removed_at) return updateMessage({ ...removedView(e) });
      return Response.json(removeModal(e, "msg"));

    case "rst": {
      const restored = (await restoreEvent(env, id))!;
      return updateMessage({ ...activeView(restored, env.PUBLIC_URL, `♻️ Restored by <@${user}>`) });
    }
  }

  const existing = await env.DB.prepare("SELECT remind FROM interest WHERE event_id = ? AND user_id = ?")
    .bind(id, user)
    .first<{ remind: number }>();

  switch (action) {
    case "int": {
      if (existing) {
        await env.DB.prepare("DELETE FROM interest WHERE event_id = ? AND user_id = ?").bind(id, user).run();
        return reply({ content: `Removed **${e.title}** from your list.` }, true);
      }
      await env.DB.prepare("INSERT INTO interest (event_id, user_id) VALUES (?, ?)").bind(id, user).run();
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM interest WHERE event_id = ?").bind(id).first<{ n: number }>();
      return reply(
        {
          content: `✅ Marked **${e.title}** as interested (${count?.n ?? 1} so far). Press ⏰ **Remind me** to get pinged before it.`,
        },
        true,
      );
    }

    case "rem": {
      if (existing?.remind) {
        await env.DB.prepare("UPDATE interest SET remind = 0 WHERE event_id = ? AND user_id = ?").bind(id, user).run();
        return reply({ content: `🔕 Reminders off for **${e.title}**.` }, true);
      }
      await env.DB.prepare(
        "INSERT INTO interest (event_id, user_id, remind) VALUES (?, ?, 1) ON CONFLICT (event_id, user_id) DO UPDATE SET remind = 1",
      )
        .bind(id, user)
        .run();
      const what = e.mode === "online" ? "submissions close" : "it starts";
      return reply({ content: `⏰ I'll ping you here 7 days and 1 day before ${what} for **${e.title}**.` }, true);
    }

    case "src":
      return reply({ content: `**Sources for ${e.title}**\n${sourcesText(e)}` }, true);
  }
  return reply({ content: "Unknown button." }, true);
}

/** "Why remove it?" pop-up submitted. */
async function handleModal(i: Interaction, env: Env, ctx: ExecutionContext): Promise<Response> {
  const [kind, idStr, origin] = (i.data?.custom_id ?? "").split(":");
  if (kind !== "rmvmodal") return reply({ content: "Unknown form." }, true);
  const reason = (modalValue(i.data?.components, "reason") ?? "").trim();
  if (reason.length < 3) return reply({ content: "Please give a reason (at least 3 characters)." }, true);

  // Opened from a post's button: replace that post in place.
  if (origin === "msg" && i.message) {
    const e = (await removeEvent(env, Number(idStr), userId(i), reason))!;
    return updateMessage({ ...removedView(e) });
  }
  return reply(await applyRemoval(env, ctx, Number(idStr), userId(i), reason));
}

async function handleAutocomplete(i: Interaction, env: Env): Promise<Response> {
  const query = String(i.data?.options?.find((o) => o.focused)?.value ?? "");
  // Removed ones are included (marked) so they can be restored.
  const rows = await env.DB.prepare(
    "SELECT id, title, start_date, removed_at FROM events WHERE end_date >= ? AND title LIKE ? ORDER BY removed_at IS NOT NULL, start_date LIMIT 25",
  )
    .bind(todayIso(), `%${query}%`)
    .all<Pick<EventRow, "id" | "title" | "start_date" | "removed_at">>();
  return Response.json({
    type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
    data: {
      choices: rows.results.map((r) => ({
        name: `${r.removed_at ? "🗑️ " : ""}${r.title} · ${r.start_date}`.slice(0, 100),
        value: String(r.id),
      })),
    },
  });
}
