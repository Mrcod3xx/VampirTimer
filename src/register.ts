import "dotenv/config";
import { REST, Routes } from "discord.js";
import { readConfig } from "./config/env.js";
import { commands } from "./bot/commands.js";
import { errorCode } from "./utils/logger.js";
try {
  const config = readConfig();
  const rest = new REST({
    version: "10",
    retries: 0,
    timeout: 15000,
    rejectOnRateLimit: () => true,
  }).setToken(config.DISCORD_TOKEN);
  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(
        config.DISCORD_CLIENT_ID,
        config.DISCORD_GUILD_ID,
      )
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commands.map((c) => c.toJSON()) });
  console.log(
    `Registered ${commands.length} root commands ${config.DISCORD_GUILD_ID ? "to the test guild" : "globally"}.`,
  );
} catch (error) {
  console.error(
    `Command registration failed: ${errorCode(error)}. Check environment, application ID and rate limits.`,
  );
  process.exitCode = 1;
}
