// Slash command definitions. Shared by the Worker and scripts/register-commands.ts,
// so this file must not import anything.

export const CATEGORY_CHOICES = [
  { name: "All", value: "all" },
  { name: "Denmark (on-site)", value: "denmark" },
  { name: "Europe (on-site)", value: "europe" },
  { name: "Online, ≤5 days", value: "online-short" },
  { name: "Online, long-form", value: "online-long" },
  { name: "⭐ Flagship only", value: "flagship" },
  { name: "🗑️ Removed (with reasons)", value: "removed" },
];

export const COMMANDS = [
  {
    name: "hackathons",
    description: "List upcoming hackathons the bot is tracking",
    options: [
      {
        type: 3, // STRING
        name: "category",
        description: "Which kind (default: all)",
        required: false,
        choices: CATEGORY_CHOICES,
      },
      {
        type: 4, // INTEGER
        name: "within_days",
        description: "Only events starting within this many days (default 60, or 365 when sorting by prize)",
        required: false,
        min_value: 1,
        max_value: 365,
      },
      {
        type: 3,
        name: "sort",
        description: "Order of the list (default: soonest first)",
        required: false,
        choices: [
          { name: "Soonest first", value: "date" },
          { name: "🏆 Prize – highest cash first", value: "prize" },
          { name: "⏳ Registration deadline – soonest first", value: "deadline" },
        ],
      },
    ],
  },
  {
    name: "hackathon",
    description: "Show, remove or restore one hackathon",
    options: [
      {
        type: 3,
        name: "name",
        description: "Start typing a hackathon name",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "action",
        description: "What to do (default: show)",
        required: false,
        choices: [
          { name: "Show details & sources", value: "show" },
          { name: "Remove (hide it, with a reason)", value: "remove" },
          { name: "Restore a removed one", value: "restore" },
        ],
      },
      {
        type: 3,
        name: "reason",
        description: "Why remove it, e.g. only for high-school students (asked in a pop-up if left out)",
        required: false,
        max_length: 400,
      },
    ],
  },
  {
    name: "interested",
    description: "Show the hackathons you marked as interested",
  },
  {
    name: "config",
    description: "Configure when and where the bot posts (Manage Server only)",
    default_member_permissions: "32", // MANAGE_GUILD
    contexts: [0], // servers only
    options: [
      { type: 1, name: "show", description: "Show the current settings" },
      {
        type: 1,
        name: "mode",
        description: "When to post: on every new hackathon, a daily digest, or both",
        options: [
          {
            type: 3,
            name: "value",
            description: "Posting mode",
            required: true,
            choices: [
              { name: "Instant – post each new hackathon", value: "instant" },
              { name: "Daily – one digest per day", value: "daily" },
              { name: "Both – instant posts + daily digest", value: "both" },
            ],
          },
        ],
      },
      {
        type: 1,
        name: "time",
        description: "Hour of the daily digest and reminders (local time)",
        options: [{ type: 4, name: "hour", description: "0–23, e.g. 10 for 10:00", required: true, min_value: 0, max_value: 23 }],
      },
      {
        type: 1,
        name: "timezone",
        description: "Time zone for the daily hour",
        options: [{ type: 3, name: "name", description: "IANA name, e.g. Europe/Copenhagen", required: true }],
      },
      {
        type: 1,
        name: "channel",
        description: "Channel the bot posts in",
        options: [{ type: 7, name: "channel", description: "Text channel", required: true, channel_types: [0, 5] }],
      },
      {
        type: 1,
        name: "categories",
        description: "Which kinds of hackathons get announced (leave out to keep as is)",
        options: [
          { type: 5, name: "denmark", description: "Denmark on-site" },
          { type: 5, name: "europe", description: "Europe on-site" },
          { type: 5, name: "online_short", description: "Online, ≤5 days" },
          { type: 5, name: "online_long", description: "Online, long-form" },
        ],
      },
      {
        type: 2, // SUB_COMMAND_GROUP
        name: "luma",
        description: "Luma calendars and city pages to watch for hackathons",
        options: [
          { type: 1, name: "list", description: "Show the Luma pages being watched" },
          {
            type: 1,
            name: "add",
            description: "Watch a Luma calendar or city page",
            options: [{ type: 3, name: "page", description: "e.g. eurodefensetech, berlin or a luma.com link", required: true }],
          },
          {
            type: 1,
            name: "remove",
            description: "Stop watching a Luma page",
            options: [{ type: 3, name: "page", description: "Name as shown in /config luma list", required: true }],
          },
        ],
      },
      {
        type: 2,
        name: "flagship",
        description: "Prestigious hackathons, highlighted in gold with a ⭐",
        options: [
          { type: 1, name: "list", description: "Show the flagship list" },
          {
            type: 1,
            name: "add",
            description: "Mark hackathons whose name contains this as flagship",
            options: [{ type: 3, name: "name", description: "e.g. Junction or HackZurich", required: true, max_length: 60 }],
          },
          {
            type: 1,
            name: "remove",
            description: "Remove a name from the flagship list",
            options: [{ type: 3, name: "name", description: "As shown in /config flagship list", required: true }],
          },
        ],
      },
      { type: 1, name: "preview", description: "Show what today's digest would look like (only you see it)" },
      { type: 1, name: "refresh", description: "Check all sources for new hackathons now" },
    ],
  },
];
