import { createHash } from "node:crypto";
import type { Client } from "discord.js";
import type { Store } from "../database/store.js";
import { commands } from "../bot/commands.js";

interface SyncState {
  scope: string;
  hash: string;
  cleanedGuilds: string[];
}
export async function syncCommands(
  store: Store,
  client: Client,
  guildId?: string,
) {
  if (!client.application)
    throw new Error("Discord application is unavailable");
  const scope = guildId ?? "global";
  const data = commands.map((command) => command.toJSON());
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const key = `commands:${client.application.id}`;
  const row = store.db
    .prepare("SELECT value FROM metadata WHERE key=?")
    .get(key) as { value: string } | undefined;
  const previous = row ? (JSON.parse(row.value) as SyncState) : undefined;
  const changed = previous?.scope !== scope || previous?.hash !== hash;
  const cleaned = new Set(
    previous?.scope === scope ? previous.cleanedGuilds : [],
  );
  if (guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error("Configured command guild is not connected");
    if (changed) await guild.commands.set(commands);
    if (previous?.scope !== scope) {
      await client.application.commands.set([]);
      if (previous && previous.scope !== "global") {
        const old = client.guilds.cache.get(previous.scope);
        if (old) await old.commands.set([]);
      }
    }
  } else {
    // Publish the replacement before removing stale guild-scoped definitions.
    if (changed) await client.application.commands.set(commands);
    for (const guild of client.guilds.cache.values()) {
      if (!cleaned.has(guild.id)) {
        await guild.commands.set([]);
        cleaned.add(guild.id);
      }
    }
  }
  store.db
    .prepare(
      "INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, JSON.stringify({ scope, hash, cleanedGuilds: [...cleaned] }));
  return changed;
}
