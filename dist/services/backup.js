import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, statSync, } from "node:fs";
import { dirname, join, resolve } from "node:path";
const held = new Set();
export function acquireProcessLock(databasePath) {
    const path = resolve(databasePath) + ".lock";
    mkdirSync(dirname(path), { recursive: true });
    const owner = randomBytes(16).toString("hex");
    const create = () => {
        const fd = openSync(path, "wx", 0o600);
        try {
            writeFileSync(fd, JSON.stringify({ pid: process.pid, owner }));
        }
        finally {
            closeSync(fd);
        }
    };
    try {
        create();
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
        if (held.has(path))
            throw new Error("Bot process is already using this database.");
        const old = JSON.parse(readFileSync(path, "utf8"));
        if (!Number.isSafeInteger(old.pid) || old.pid <= 0)
            throw new Error("Invalid process lock. Stop the bot and inspect the .lock file.");
        let alive = old.pid !== process.pid;
        if (alive) {
            try {
                process.kill(old.pid, 0);
            }
            catch (e) {
                if (e.code === "ESRCH")
                    alive = false;
            }
        }
        if (alive)
            throw new Error("Another process is using this database. Stop it before starting or restoring.");
        unlinkSync(path);
        create();
    }
    held.add(path);
    return () => {
        held.delete(path);
        if (existsSync(path) &&
            JSON.parse(readFileSync(path, "utf8")).owner ===
                owner)
            unlinkSync(path);
    };
}
export function verifyDatabase(path) {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
        if (db.pragma("integrity_check", { simple: true }) !== "ok")
            throw new Error("SQLite integrity check failed.");
        if (db.pragma("foreign_key_check").length)
            throw new Error("SQLite foreign-key check failed.");
        if (!db
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='guild_settings'")
            .get())
            throw new Error("This is not a boss tracker database.");
        return {
            guilds: db.prepare("SELECT COUNT(*) AS n FROM guild_settings").get().n,
        };
    }
    finally {
        db.close();
    }
}
export async function backup(store, directory = join(dirname(resolve(store.path)), "backups"), maxBackups = 3) {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `boss-tracker-${Date.now()}-${randomBytes(3).toString("hex")}.db`);
    await store.db.backup(path);
    verifyDatabase(path);
    const files = readdirSync(directory)
        .filter((n) => /^boss-tracker-\d+-[a-f0-9]{6}\.db$/.test(n))
        .map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    for (const file of files.slice(maxBackups))
        unlinkSync(join(directory, file.name));
    return path;
}
export async function restore(source, target) {
    source = resolve(source);
    target = resolve(target);
    if (source === target)
        throw new Error("Backup source and database destination must differ.");
    verifyDatabase(source);
    const release = acquireProcessLock(target);
    const stage = target + ".restore-" + randomBytes(6).toString("hex");
    try {
        // Preserve a verified rollback snapshot of the current database before replacing it.
        if (existsSync(target)) {
            const old = new Database(target);
            try {
                await old.backup(target + ".before-restore.db");
                old.pragma("wal_checkpoint(TRUNCATE)");
            }
            finally {
                old.close();
            }
            verifyDatabase(target + ".before-restore.db");
        }
        const input = new Database(source, { readonly: true, fileMustExist: true });
        try {
            await input.backup(stage);
        }
        finally {
            input.close();
        }
        verifyDatabase(stage);
        // The bot is stopped and the current database checkpointed; obsolete WAL/SHM must not replay.
        for (const suffix of ["-wal", "-shm"])
            if (existsSync(target + suffix))
                unlinkSync(target + suffix);
        renameSync(stage, target);
        return verifyDatabase(target);
    }
    finally {
        if (existsSync(stage))
            unlinkSync(stage);
        release();
    }
}
//# sourceMappingURL=backup.js.map