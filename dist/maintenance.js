import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Store } from "./database/store.js";
import { backup, restore, verifyDatabase } from "./services/backup.js";
import { errorCode } from "./utils/logger.js";
const path = process.env.DATABASE_PATH || "./data/boss-tracker.db";
try {
    const action = process.argv[2];
    if (action === "restore") {
        const source = process.argv[3];
        if (!source)
            throw new Error("Usage: npm run restore -- path/to/backup.db (bot must be stopped)");
        console.log("Restored verified database:", await restore(source, path));
    }
    else {
        const store = new Store(path);
        try {
            if (action === "backup")
                console.log("Verified backup:", await backup(store));
            else if (action === "check") {
                const key = "storage_probe";
                const old = store.db
                    .prepare("SELECT value FROM metadata WHERE key=?")
                    .get(key);
                if (old)
                    console.log("Existing persistence probe:", old.value, "— compare with the value before restarting the hosting server.");
                else {
                    const value = randomUUID();
                    store.db
                        .prepare("INSERT INTO metadata(key,value) VALUES (?,?)")
                        .run(key, value);
                    console.log("Created persistence probe:", value, "— rerun after a host restart and compare.");
                }
                console.log("Database integrity:", verifyDatabase(path));
            }
            else if (action === "inspect") {
                console.table(store.db
                    .prepare("SELECT guild_id,status,COUNT(*) AS events FROM notification_logs GROUP BY guild_id,status")
                    .all());
                console.table(store.db
                    .prepare("SELECT guild_id,status,error_message,scheduled_at FROM notification_logs WHERE error_message IS NOT NULL ORDER BY scheduled_at DESC LIMIT 20")
                    .all());
                console.log("RSS MB:", Math.round(process.memoryUsage().rss / 1048576));
            }
            else if (action === "seed-1star" || action === "seed-2star" || action === "seed-bosses") {
                const guilds = store.db
                    .prepare("SELECT guild_id FROM guild_settings")
                    .all();
                const oneStarBosses = [
                    "Lv. 56 Mildis",
                    "Lv. 56 Regan",
                    "Lv. 56 Avok",
                    "Lv. 60 Eligo",
                    "Lv. 60 Lussem",
                    "Lv. 60 Arto",
                ];
                const twoStarBosses = [
                    "Lv. 62 Guardian Beast Gazoth",
                    "Lv. 62 Guardian Beast K'Valkan",
                    "Lv. 62 Guardian Beast Beherd",
                ];
                for (const g of guilds) {
                    if (action !== "seed-2star") {
                        for (const name of oneStarBosses) {
                            try {
                                store.saveBoss(g.guild_id, {
                                    name,
                                    description: "1-Star Gehenna Boss",
                                    enabled: true,
                                    times: "14:00,18:00,22:00",
                                });
                                console.log(`Added ${name} to guild ${g.guild_id}`);
                            }
                            catch {
                                console.log(`Skipped ${name} (already exists)`);
                            }
                        }
                    }
                    if (action !== "seed-1star") {
                        for (const name of twoStarBosses) {
                            try {
                                store.saveBoss(g.guild_id, {
                                    name,
                                    description: "2-Star Gehenna Boss",
                                    enabled: true,
                                    times: "14:00,22:00",
                                });
                                console.log(`Added ${name} to guild ${g.guild_id}`);
                            }
                            catch {
                                console.log(`Skipped ${name} (already exists)`);
                            }
                        }
                    }
                }
                console.log("Bosses populated successfully.");
            }
            else
                throw new Error("Use backup, check, inspect, restore, or seed-bosses.");
        }
        finally {
            store.close();
        }
    }
}
catch (error) {
    console.error("Maintenance failed:", error instanceof Error ? error.message : errorCode(error));
    process.exitCode = 1;
}
//# sourceMappingURL=maintenance.js.map