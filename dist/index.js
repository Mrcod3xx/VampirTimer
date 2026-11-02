import { Events, RESTEvents } from "discord.js";
import { Store } from "./database/store.js";
import { readConfig } from "./config/env.js";
import { createClient } from "./bot/client.js";
import { Components } from "./ui/components.js";
import { Views } from "./ui/views.js";
import { Router } from "./bot/router.js";
import { commands } from "./bot/commands.js";
import { Notifications } from "./services/notifications.js";
import { Scheduler } from "./services/scheduler.js";
import { errorCode, log } from "./utils/logger.js";
import { acquireProcessLock } from "./services/backup.js";
async function main() {
    const config = readConfig();
    const release = acquireProcessLock(config.DATABASE_PATH);
    const store = new Store(config.DATABASE_PATH);
    const client = createClient();
    const notifications = new Notifications(store, client);
    const router = new Router(store, new Views(store, new Components(store)), notifications);
    const scheduler = new Scheduler(store, notifications, () => [...client.guilds.cache.keys()], Date.now, config.LATENESS_SECONDS * 1000, config.HISTORY_DAYS);
    let stopping = false;
    const shutdown = async () => {
        if (stopping)
            return;
        stopping = true;
        log("info", "Stopping scheduler and Discord client");
        const deadline = setTimeout(() => {
            log("error", "Shutdown timed out; pending sends will be uncertain on restart");
            process.exit(1);
        }, 20000);
        deadline.unref();
        await scheduler.stop();
        client.destroy();
        store.close();
        release();
        clearTimeout(deadline);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    client.once(Events.ClientReady, async () => {
        try {
            for (const guild of client.guilds.cache.values()) {
                store.initGuild(guild.id);
                await router.publicPanel.refresh(guild.id).catch(() => { });
            }
            scheduler.start();
            // Sync slash commands cleanly without duplicating across global and guild scopes
            try {
                if (config.DISCORD_GUILD_ID) {
                    const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
                    if (guild) {
                        await guild.commands.set(commands);
                        if (client.application) {
                            await client.application.commands.set([]).catch(() => { });
                        }
                        log("info", "Synced slash commands to target guild", {
                            guild: config.DISCORD_GUILD_ID,
                            count: commands.length,
                        });
                    }
                }
                else {
                    // Remove any leftover guild-scoped commands so Discord never shows duplicate entries
                    for (const guild of client.guilds.cache.values()) {
                        await guild.commands.set([]).catch(() => { });
                    }
                    if (client.application) {
                        await client.application.commands.set(commands);
                        log("info", "Synced slash commands globally", {
                            count: commands.length,
                        });
                    }
                }
            }
            catch (err) {
                log("warn", "Slash command sync failed", { code: errorCode(err) });
            }
            log("info", "Boss tracker ready", {
                guilds: client.guilds.cache.size,
                rssMB: Math.round(process.memoryUsage().rss / 1048576),
                timezone: "Asia/Manila",
            });
        }
        catch (error) {
            log("error", "Startup initialization failed", { code: errorCode(error) });
            void shutdown();
        }
    });
    client.on(Events.GuildCreate, (guild) => {
        try {
            store.initGuild(guild.id);
            void guild.commands.set([]).catch(() => { });
            void router.publicPanel.refresh(guild.id).catch(() => { });
        }
        catch (error) {
            log("error", "Guild initialization failed", { code: errorCode(error) });
        }
    });
    client.on(Events.InteractionCreate, (i) => {
        if (!stopping)
            void router.handle(i);
    });
    client.on(Events.Error, (error) => log("error", "Discord client error", { code: errorCode(error) }));
    client.on(Events.ShardError, (error) => log("warn", "Discord gateway connection error", { code: errorCode(error) }));
    client.on(Events.ShardDisconnect, () => log("warn", "Discord disconnected; scheduled alerts remain bounded by their lateness window"));
    client.rest.on(RESTEvents.RateLimited, () => log("warn", "Discord rate limit reached; waiting or deferring work. Do not restart repeatedly."));
    try {
        await client.login(config.DISCORD_TOKEN);
    }
    catch (error) {
        log("error", "Discord login failed. Check token or shared-IP restrictions; stop automatic host restarts before retrying.", { code: errorCode(error) });
        await shutdown();
        process.exitCode = 1;
    }
}
main().catch((error) => {
    // Configuration errors contain field names only, never token values.
    if (error instanceof Error &&
        error.message.startsWith("Invalid environment:"))
        console.error(error.message);
    else
        log("error", "Startup failed; inspect runtime, database path and process lock", { code: errorCode(error) });
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map