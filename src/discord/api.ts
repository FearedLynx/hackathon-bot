import type { Env } from "../types.ts";

const API = "https://discord.com/api/v10";

export interface MessageBody {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  allowed_mentions?: { parse?: string[]; users?: string[] };
}

async function discordFetch(env: Env, path: string, init: RequestInit, retried = false): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (res.status === 429 && !retried) {
    const { retry_after = 1 } = (await res.json()) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.min(retry_after, 10) * 1000));
    return discordFetch(env, path, init, true);
  }
  if (!res.ok) throw new Error(`Discord ${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  return res;
}

export async function editMessage(env: Env, channelId: string, messageId: string, body: MessageBody): Promise<void> {
  await discordFetch(env, `/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
  });
}

/** Posts to a channel and returns the new message id. */
export async function postMessage(env: Env, channelId: string, body: MessageBody): Promise<string> {
  const res = await discordFetch(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
  });
  return ((await res.json()) as { id: string }).id;
}
