export type Mode = "online" | "in-person" | "hybrid";
export type Category = "denmark" | "europe" | "online-short" | "online-long";

/** An event as produced by a source adapter, before classification. */
export interface RawEvent {
  source: string;
  sourceId: string;
  title: string;
  url: string;
  sourceUrl: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  location: string | null;
  country: string | null; // ISO 3166-1 alpha-2
  mode: Mode;
  prize: string | null;
  teamSize: string | null;
  themes: string[];
  regStatus?: string | null; // e.g. "Open – approval required", when there is no fixed deadline
  regDeadline?: string | null; // ISO UTC, when the source states it directly
}

/** A row of the `events` table. */
export interface EventRow {
  id: number;
  source_key: string;
  source: string;
  title: string;
  dedupe_key: string;
  url: string;
  source_url: string;
  start_date: string;
  end_date: string;
  location: string | null;
  country: string | null;
  mode: Mode;
  category: Category;
  prize: string | null;
  team_size: string | null;
  themes: string | null;
  fingerprint: string;
  reg_deadline: string | null;
  deadline_checked: number; // 1 once the event's own page has been checked
  prize_detail: string | null;
  eligibility: string | null;
  verify_note: string | null;
  flagship: number;
  reg_status: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason: string | null;
  first_seen: string;
  updated_at: string;
  posted_at: string | null;
  message_id: string | null;
}

export interface Env {
  DB: D1Database;
  DISCORD_APP_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  CHANNEL_ID: string;
  PUBLIC_URL: string; // this Worker's URL, for calendar links
}

export const USER_AGENT = "hackathon-bot/0.1 (Discord hackathon notifier)";
