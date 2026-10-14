# Hackathon Bot

Discord bot that tracks upcoming hackathons and posts new ones into one channel.
Runs on Cloudflare Workers (free plan) with a D1 database. No AI, no server to keep running.

## What it does

- **Every hour** fetches hackathons from Devpost (online), MLH (Europe on-site), Luma (European Defense Tech
  Hackathons, ETHGlobal, and city feeds for Copenhagen, the Nordics and major EU tech hubs) and dev.events, drops duplicates, and files each one under:
  - 🇩🇰 Denmark on-site (≤5 days) · 🇪🇺 Europe on-site (≤5 days) · 💻 Online ≤5 days · 🗓️ Online long-form
- Announces new events depending on the **mode** (set with `/config mode`):
  - `instant` (default): posts each new event (max 8 per run) with buttons **✅ Interested**, **⏰ Remind me**,
    **🔗 Sources**, **Open**.
  - `daily`: one digest per day at the configured hour (default 10:00 Europe/Copenhagen) with new events and
    what starts in the next 7 days.
  - `both`: instant posts plus the daily digest.
  The first run only posts a summary, so the channel isn't flooded.
- Announces date changes for events it already posted.
- **Reminders** at the configured hour: pings people who pressed ⏰ 7 days and 1 day before an on-site event
  starts, or before an online event's submissions close.

### Slash commands

| Command | |
|---|---|
| `/hackathons [category] [within_days] [sort]` | List upcoming events; `sort:` soonest (default), 🏆 prize (highest cash first, ≈ EUR, non-cash = 0) or ⏳ registration deadline |
| `/hackathon <name> [action] [reason]` | Details + sources (default), **Remove** with a reason, or **Restore** |
| `/interested` | Your marked events (only you see it) |
| `/config show` | Current settings (Manage Server only, like every `/config` command) |
| `/config mode <instant\|daily\|both>` | When to announce new events |
| `/config time <hour>` | Local hour of the digest and reminders (0–23) |
| `/config timezone <name>` | IANA time zone, e.g. `Europe/Copenhagen` |
| `/config channel <#channel>` | Where the bot posts |
| `/config categories [denmark] [europe] [online_short] [online_long]` | Turn categories on/off for announcements |
| `/config flagship list|add|remove` | Names marked as ⭐ flagship (gold) |
| `/config luma list|add|remove` | Luma calendars/city pages to watch (e.g. `add eurodefensetech`) |
| `/config preview` | See today's digest privately |
| `/config refresh` | Check sources now instead of waiting for the hourly run |

Settings live in the `settings` table, so changes apply immediately without a redeploy.

### Every event is checked on its own page before it's announced

Listings are often wrong (an "online" robot contest that's on-site in India, "$40,000 in prizes" that's all
credits), so before posting, the bot reads each Devpost event page and Luma event description for:

- **Prize**: the real cash total from the prize list ("₹55,000 cash", "No cash · 5 non-cash prizes (1st: …)").
  Amounts in titles are ignored.
- **Who can join** (students only, ages, high school only, allowed countries) and **team size**.
- **On-site signals** in the organizer's own text ("bring your robot", "technical inspection", "venue: …").

Events a team of 4 from Denmark can't join are **auto-removed with the reason** (country-restricted without
Denmark, high-school only, team size excluding 4, or listed online but on-site). They show up under
`/hackathons category:Removed` and can be restored. Rules: `assess()` in `src/details/check.ts`.

### Flagship hackathons

Prestigious hackathons (Junction, hackaTUM, HackZurich, START Hack, HackUPC, ETHGlobal, NASA Space Apps, …)
get a ⭐ and a gold embed. Edit the list with `/config flagship add|remove|list`. Junction, hackaTUM and
HackUPC are also read straight from their own websites (`src/sources/sites.ts`), including deadlines and
team sizes from their FAQs.

### Removing hackathons that don't fit

Every post has a **🗑️ Remove** button (or use `/hackathon <name> action:Remove`). A pop-up asks why; the post
turns into "Removed by @user" with the reason as a spoiler (collapsed until clicked) and a **♻️ Restore** button.
Removed hackathons are hidden from lists, digests and reminders, and stay removed when sources are re-fetched.
Anyone in the server can remove or restore.

Every listing shows **registration deadline │ dates │ Add to calendar**:

- **Deadline**: Devpost registration stays open until the submission deadline, which is read from each
  event page (15 lookups per run) and shown as a Discord timestamp, so everyone sees it in their own time zone.
  Luma has no deadline; it shows the registration status instead (open, approval required, waitlist, sold out).
  MLH and dev.events don't publish deadlines ("not published").
- **Add to calendar** links to `/cal/<id>` on the Worker: a small page with Google Calendar and Apple/Outlook
  (`/cal/<id>.ics`). The .ics also contains the deadline with a 1-day reminder; for long online events the
  Google link adds the deadline instead of a weeks-long block.
- **Prize**: Devpost only counts cash, so non-cash prizes fall back to the amount in the title or the number of
  prizes. MLH and dev.events don't publish prizes.

Team size isn't published by any of the sources, so it shows "Not listed – check event page".

## Setup

### 1. Discord application
1. <https://discord.com/developers/applications> → **New Application** (e.g. "Hackathon Bot").
2. **General Information**: copy **Application ID** and **Public Key**.
3. **Bot** → **Reset Token** → copy the token. No privileged intents are needed.
4. **Installation** (or OAuth2 → URL Generator): scopes `bot` + `applications.commands`,
   permissions **View Channels**, **Send Messages**, **Embed Links**. Open the link and add the bot to your server.
5. In Discord: Settings → Advanced → **Developer Mode** on. Right-click your hackathon channel →
   **Copy Channel ID**; right-click the server icon → **Copy Server ID**.

### 2. Local config
```sh
cp .dev.vars.example .dev.vars   # then fill in the five values
npm install
npm run register                 # registers the slash commands (instantly, if GUILD_ID is set)
```

### 3. Cloudflare
```sh
npx wrangler login
npx wrangler d1 create hackathon-bot   # paste the printed database_id into wrangler.jsonc
npm run db:init
npm run deploy                         # prints https://hackathon-bot.<you>.workers.dev
npm run secrets                        # uploads .dev.vars as Worker secrets
```

### 4. Connect Discord to the Worker
Developer Portal → **General Information** → **Interactions Endpoint URL** = your workers.dev URL → **Save**.
Discord sends a test request; if it saves, the bot is live. The first summary post appears on the next
hourly run, or right away with `/config refresh`.

## Development

```sh
npm run dry-run     # fetch all sources live and print what would be tracked (no Discord/Cloudflare needed)
npm test            # parser + classification tests
npm run typecheck
npm run dev         # local Worker; trigger the cron with: curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=0+*+*+*+*"
```

Adding a source: write `src/sources/<name>.ts` that returns `RawEvent[]` and register it in
`src/sources/index.ts`. Sources earlier in that list win when the same event appears twice.
Tunables: `MAX_SHORT_DAYS` (classify.ts), `MAX_POSTS_PER_RUN` (ingest.ts), `REMIND_AT_DAYS` (reminders.ts),
cron schedule (wrangler.jsonc); everything else is in `/config`.

## License

Copyright © 2026 Franciszek Kossut. **All rights reserved.** This code is public for viewing only; no license is granted to copy, modify, distribute or use it. See [LICENSE](LICENSE).
