import { todayIso } from "./dates.ts";
import { previewDigest } from "./digest.ts";
import { CATEGORY_LABEL } from "./discord/embeds.ts";
import { runIngest } from "./ingest.ts";
import {
  ALL_CATEGORIES,
  getSettings,
  isValidTimezone,
  localTime,
  setSetting,
  updateFlagships,
  type Settings,
} from "./settings.ts";
import { resolveLumaFeed, type LumaFeed } from "./sources/luma.ts";
import type { Category, Env } from "./types.ts";

export interface ConfigOption {
  name: string;
  value?: string | number | boolean;
  options?: ConfigOption[];
}

type Reply = { content?: string; embeds?: unknown[] };

const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

export const canConfigure = (permissions: string | undefined) => {
  const p = BigInt(permissions ?? "0");
  return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
};

const MODE_TEXT: Record<Settings["mode"], string> = {
  instant: "Instant – each new hackathon is posted when found",
  daily: "Daily – one digest per day",
  both: "Both – instant posts + a daily digest",
};

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function settingsEmbed(s: Settings, title = "⚙️ Bot settings") {
  return {
    title,
    color: 0x5865f2,
    fields: [
      { name: "Mode", value: MODE_TEXT[s.mode] },
      {
        name: s.mode === "instant" ? "Reminders at" : "Digest + reminders at",
        value: `${hh(s.dailyHour)} (${s.timezone})`,
        inline: true,
      },
      { name: "Channel", value: `<#${s.channelId}>`, inline: true },
      {
        name: "Announced categories",
        value: s.categories.length ? s.categories.map((c) => CATEGORY_LABEL[c]).join("\n") : "None (bot is silent)",
      },
    ],
    footer: { text: "New hackathons are checked every hour · /config <setting> to change" },
  };
}

/** Checks the bot can see and post in a channel. */
async function canPostIn(env: Env, channelId: string) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  return res.ok;
}

export async function handleConfig(
  sub: ConfigOption | undefined,
  env: Env,
  ctx: ExecutionContext,
): Promise<Reply> {
  const opt = (name: string) => sub?.options?.find((o) => o.name === name)?.value;
  const s = await getSettings(env);

  switch (sub?.name) {
    case "show":
      return { embeds: [settingsEmbed(s)] };

    case "mode": {
      const mode = String(opt("value")) as Settings["mode"];
      await setSetting(env, "mode", mode);
      return { embeds: [settingsEmbed({ ...s, mode }, "✅ Mode updated")] };
    }

    case "time": {
      const hour = Number(opt("hour"));
      await setSetting(env, "daily_hour", String(hour));
      // Allow a digest today if the new hour is still ahead.
      await setSetting(env, "last_digest_date", "");
      return { embeds: [settingsEmbed({ ...s, dailyHour: hour, lastDigestDate: null }, "✅ Time updated")] };
    }

    case "timezone": {
      const tz = String(opt("name")).trim();
      if (!isValidTimezone(tz)) {
        return { content: `“${tz}” isn't a time zone I know. Use an IANA name like \`Europe/Copenhagen\` or \`Europe/Warsaw\`.` };
      }
      await setSetting(env, "timezone", tz);
      return { embeds: [settingsEmbed({ ...s, timezone: tz }, "✅ Time zone updated")] };
    }

    case "channel": {
      const channelId = String(opt("channel"));
      if (!(await canPostIn(env, channelId))) {
        return { content: `I can't see <#${channelId}>. Give me **View Channel** and **Send Messages** there first.` };
      }
      await setSetting(env, "channel_id", channelId);
      return { embeds: [settingsEmbed({ ...s, channelId }, "✅ Channel updated")] };
    }

    case "categories": {
      const toggles: Record<string, Category> = {
        denmark: "denmark",
        europe: "europe",
        online_short: "online-short",
        online_long: "online-long",
      };
      const next = new Set(s.categories);
      for (const o of sub.options ?? []) {
        const cat = toggles[o.name];
        if (cat) o.value ? next.add(cat) : next.delete(cat);
      }
      const categories = ALL_CATEGORIES.filter((c) => next.has(c));
      await setSetting(env, "categories", categories.join(","));
      return { embeds: [settingsEmbed({ ...s, categories }, "✅ Categories updated")] };
    }

    case "luma": {
      const action = sub.options?.[0];
      const page = String(action?.options?.find((o) => o.name === "page")?.value ?? "").trim();
      const list = (feeds: LumaFeed[]) =>
        feeds.map((f) => `• [${f.slug}](https://luma.com/${f.slug}) · ${f.kind === "place" ? "city" : "calendar"}`).join("\n") || "None";
      const save = (feeds: LumaFeed[]) => setSetting(env, "luma_feeds", JSON.stringify(feeds));

      if (action?.name === "add") {
        const feed = await resolveLumaFeed(page);
        if (!feed) return { content: `Couldn't find a Luma calendar or city page at “${page}”. Use the part after luma.com/, e.g. \`eurodefensetech\`.` };
        if (s.lumaFeeds.some((f) => f.id === feed.id)) return { content: `Already watching **${feed.slug}**.` };
        const feeds = [...s.lumaFeeds, feed];
        await save(feeds);
        return { content: `✅ Now watching **${feed.slug}** (${feed.kind === "place" ? "city" : "calendar"}). Checked within the next few hours.\n\n${list(feeds)}` };
      }
      if (action?.name === "remove") {
        const slug = page.replace(/^https?:\/\/(www\.)?(lu\.ma|luma\.com)\//, "").toLowerCase();
        const feeds = s.lumaFeeds.filter((f) => f.slug.toLowerCase() !== slug);
        if (feeds.length === s.lumaFeeds.length) return { content: `Not watching “${page}”.\n\n${list(s.lumaFeeds)}` };
        await save(feeds);
        return { content: `Stopped watching **${slug}**.\n\n${list(feeds)}` };
      }
      return {
        embeds: [
          {
            title: `🔭 Watched Luma pages (${s.lumaFeeds.length})`,
            description: list(s.lumaFeeds).slice(0, 4000),
            color: 0x5865f2,
            footer: { text: "EDTH and Copenhagen are checked hourly, the rest in rotation · /config luma add" },
          },
        ],
      };
    }

    case "flagship": {
      const action = sub.options?.[0];
      const name = String(action?.options?.find((o) => o.name === "name")?.value ?? "").trim().toLowerCase();
      const show = (list: string[]) => list.map((f) => `• ${f}`).join("\n") || "None";
      let list = s.flagships;
      if (action?.name === "add") {
        if (name.length < 3) return { content: "Use at least 3 characters so it doesn't match everything." };
        if (!list.includes(name)) list = [...list, name];
      } else if (action?.name === "remove") {
        if (!list.includes(name)) return { content: `“${name}” isn't on the list.\n\n${show(list)}` };
        list = list.filter((f) => f !== name);
      }
      if (list !== s.flagships) {
        await setSetting(env, "flagships", JSON.stringify(list));
        await updateFlagships(env, list);
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE flagship = 1 AND removed_at IS NULL AND end_date >= ?")
        .bind(todayIso())
        .first<{ n: number }>();
      return {
        embeds: [
          {
            title: `⭐ Flagship hackathons (${list.length} names)`,
            description: show(list).slice(0, 4000),
            color: 0xf1c40f,
            footer: { text: `Matched in titles, case-insensitive · ${count?.n ?? 0} upcoming flagship events tracked` },
          },
        ],
      };
    }

    case "preview":
      return await previewDigest(env, s, localTime(s.timezone).date);

    case "refresh":
      ctx.waitUntil(
        runIngest(env, s, todayIso()).then(
          (r) => console.log("manual ingest", JSON.stringify(r)),
          (err) => console.error("manual ingest failed", err),
        ),
      );
      return {
        content:
          s.mode === "daily"
            ? `🔄 Checking all sources now. New hackathons will be in the digest at ${hh(s.dailyHour)}.`
            : `🔄 Checking all sources now. New hackathons will be posted in <#${s.channelId}> in a few seconds.`,
      };
  }
  return { content: "Unknown setting." };
}
