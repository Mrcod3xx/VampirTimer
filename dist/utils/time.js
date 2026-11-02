import { DateTime } from "luxon";
import { UserError } from "./logger.js";
export const ZONE = "Asia/Manila";
export const zoneLabel = "Philippine Time (UTC+8)";
export function parseTimes(input) {
    const parts = input.split(",").map((s) => s.trim());
    if (!parts.length || parts.length > 12)
        throw new UserError("Enter 1–12 comma-separated daily times.");
    return [
        ...new Set(parts.map((value) => {
            const twelve = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(value);
            if (twelve)
                return `${String((Number(twelve[1]) % 12) + (twelve[3].toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${twelve[2]}`;
            const twentyFour = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
            if (twentyFour)
                return `${twentyFour[1].padStart(2, "0")}:${twentyFour[2]}`;
            throw new UserError(`Invalid time "${value.slice(0, 30)}". Use 2:00 PM or 14:00.`);
        })),
    ].sort();
}
export function formatTime(time) {
    return DateTime.fromFormat(time, "HH:mm", {
        zone: ZONE,
        locale: "en",
    }).toFormat("h:mm a");
}
export function formatPhilippineTime(time) {
    return `${formatTime(time)} PHT`;
}
export function atTime(day, time) {
    const [hour, minute] = time.split(":").map(Number);
    return day.setZone(ZONE).startOf("day").set({ hour, minute });
}
export function displayInstant(ms) {
    return DateTime.fromMillis(ms, { zone: ZONE, locale: "en" }).toFormat("ccc, LLL d · h:mm a");
}
export function toUnixSeconds(val) {
    if (typeof val === "number")
        return Math.floor(val / 1000);
    if (val instanceof Date)
        return Math.floor(val.getTime() / 1000);
    return Math.floor(val.toMillis() / 1000);
}
export function discordTime(val) {
    return `<t:${toUnixSeconds(val)}:t>`;
}
export function discordShortDate(val) {
    return `<t:${toUnixSeconds(val)}:f>`;
}
export function discordFullDate(val) {
    return `<t:${toUnixSeconds(val)}:F>`;
}
export function discordRelative(val) {
    return `<t:${toUnixSeconds(val)}:R>`;
}
export function getTodayOccurrence(timeStr, nowMs = Date.now()) {
    const day = DateTime.fromMillis(nowMs, { zone: ZONE });
    return atTime(day, timeStr).toMillis();
}
export function getNextOccurrence(timeStr, nowMs = Date.now()) {
    const day = DateTime.fromMillis(nowMs, { zone: ZONE });
    let target = atTime(day, timeStr);
    if (target.toMillis() < nowMs) {
        target = target.plus({ days: 1 });
    }
    return target.toMillis();
}
export function nextSpawn(bosses, now) {
    const day = DateTime.fromMillis(now, { zone: ZONE });
    const candidates = bosses
        .filter((b) => b.enabled)
        .flatMap((boss) => boss.times.map((time) => {
        let at = atTime(day, time);
        if (at.toMillis() < now)
            at = at.plus({ days: 1 });
        return { boss, at: at.toMillis() };
    }));
    const at = Math.min(...candidates.map((c) => c.at));
    return Number.isFinite(at)
        ? { at, bosses: candidates.filter((c) => c.at === at).map((c) => c.boss) }
        : null;
}
export function groupBossesByTierAndLevel(bosses) {
    const parseBoss = (name) => {
        const gbMatch = /^(Lv\.\s*\d+)\s*Guardian\s*Beast\s*(.*)$/i.exec(name);
        if (gbMatch) {
            return {
                group: `${gbMatch[1]} Guardian Beasts:`,
                name: gbMatch[2].trim(),
            };
        }
        const lvMatch = /^(Lv\.\s*\d+)\s*(.*)$/i.exec(name);
        if (lvMatch) {
            return { group: `${lvMatch[1]}:`, name: lvMatch[2].trim() };
        }
        return { group: "Other:", name: name.trim() };
    };
    const organize = (list) => {
        const map = new Map();
        for (const b of list) {
            const { group, name } = parseBoss(b.name);
            const arr = map.get(group) ?? [];
            arr.push(name);
            map.set(group, arr);
        }
        return Array.from(map.entries()).map(([group, names]) => ({
            group,
            names,
        }));
    };
    const oneStar = bosses.filter((b) => (b.description ?? "").includes("1-Star"));
    const twoStar = bosses.filter((b) => (b.description ?? "").includes("2-Star"));
    const other = bosses.filter((b) => !(b.description ?? "").includes("1-Star") &&
        !(b.description ?? "").includes("2-Star"));
    return {
        oneStar: { count: oneStar.length, groups: organize(oneStar) },
        twoStar: { count: twoStar.length, groups: organize(twoStar) },
        other: { count: other.length, groups: organize(other) },
    };
}
//# sourceMappingURL=time.js.map