import { calendarPage, icsFile } from "./calendar.ts";
import { todayIso } from "./dates.ts";
import { runDigest } from "./digest.ts";
import { verifyDiscordRequest } from "./discord/verify.ts";
import { runIngest } from "./ingest.ts";
import { handleInteraction, type Interaction } from "./interactions.ts";
import { runReminders } from "./reminders.ts";
import { getSettings, localTime, setSetting } from "./settings.ts";
import type { Env, EventRow } from "./types.ts";

/** Runs hourly: fetch sources, and at the configured local hour send the digest and reminders. */
async function runScheduled(scheduledTime: number, env: Env) {
  const now = new Date(scheduledTime);
  const settings = await getSettings(env);
  console.log("ingest", JSON.stringify(await runIngest(env, settings, todayIso(now))));

  const local = localTime(settings.timezone, now);
  if (local.hour !== settings.dailyHour || settings.lastDigestDate === local.date) return;
  await setSetting(env, "last_digest_date", local.date);
  if (settings.mode !== "instant") {
    await runDigest(env, settings, local.date).catch((err) => console.error("digest failed", err));
  }
  console.log("reminders", JSON.stringify(await runReminders(env, settings.channelId, local.date)));
}

/** GET /cal/<id> (chooser page) and /cal/<id>.ics (calendar file). */
async function serveCalendar(url: URL, env: Env): Promise<Response | null> {
  const m = url.pathname.match(/^\/cal\/(\d+)(\.ics)?$/);
  if (!m) return null;
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(Number(m[1])).first<EventRow>();
  if (!e) return new Response("Hackathon not found", { status: 404 });
  if (m[2]) {
    const filename = e.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "hackathon";
    return new Response(icsFile(e), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.ics"`,
      },
    });
  }
  return new Response(calendarPage(e, env.PUBLIC_URL), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return (await serveCalendar(new URL(request.url), env)) ?? new Response("hackathon-bot is running");
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (body === null) return new Response("Bad request signature", { status: 401 });
    return handleInteraction(JSON.parse(body) as Interaction, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.scheduledTime, env));
  },
} satisfies ExportedHandler<Env>;
