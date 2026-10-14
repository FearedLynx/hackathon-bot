// Registers the slash commands with Discord. Run with: npm run register
// Reads DISCORD_APP_ID, DISCORD_TOKEN and optional GUILD_ID from .dev.vars.
import { COMMANDS } from "../src/commands.ts";

const { DISCORD_APP_ID, DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_APP_ID || !DISCORD_TOKEN) {
  console.error("Set DISCORD_APP_ID and DISCORD_TOKEN in .dev.vars first.");
  process.exit(1);
}

// Guild commands appear instantly; global ones can take a little while.
const path = GUILD_ID
  ? `/applications/${DISCORD_APP_ID}/guilds/${GUILD_ID}/commands`
  : `/applications/${DISCORD_APP_ID}/commands`;

const res = await fetch(`https://discord.com/api/v10${path}`, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMANDS),
});
if (!res.ok) {
  console.error(`Failed (${res.status}):`, await res.text());
  process.exit(1);
}
console.log(`Registered ${COMMANDS.length} commands ${GUILD_ID ? `in guild ${GUILD_ID}` : "globally"}.`);
