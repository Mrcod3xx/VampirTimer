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
const WEEKDAY_NAMES = {
    mon: "mon",
    monday: "mon",
    "1": "mon",
    tue: "tue",
    tues: "tue",
    tuesday: "tue",
    "2": "tue",
    wed: "wed",
    wednesday: "wed",
    "3": "wed",
    thu: "thu",
    thur: "thu",
    thurs: "thu",
    thursday: "thu",
    "4": "thu",
    fri: "fri",
    friday: "fri",
    "5": "fri",
    sat: "sat",
    saturday: "sat",
    "6": "sat",
    sun: "sun",
    sunday: "sun",
    "7": "sun",
};
export const ORDERED_WEEKDAYS = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
];
export function normalizeWeekdays(input) {
    if (!input)
        return [];
    let items;
    if (Array.isArray(input)) {
        items = input;
    }
    else {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed))
                items = parsed.map(String);
            else
                items = input.split(",").map((s) => s.trim());
        }
        catch {
            items = input.split(",").map((s) => s.trim());
        }
    }
    const set = new Set();
    for (const item of items) {
        const clean = item.trim().toLowerCase();
        const mapped = WEEKDAY_NAMES[clean];
        if (mapped)
            set.add(mapped);
    }
    return ORDERED_WEEKDAYS.filter((d) => set.has(d));
}
export function formatWeeklyDays(input) {
    const days = normalizeWeekdays(input);
    if (!days.length)
        return "None";
    const map = {
        mon: "Mon",
        tue: "Tue",
        wed: "Wed",
        thu: "Thu",
        fri: "Fri",
        sat: "Sat",
        sun: "Sun",
    };
    return days.map((d) => map[d] || d).join(", ");
}
export function parseEventDate(input) {
    const trimmed = input.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match)
        throw new UserError("Event date must use YYYY-MM-DD format (e.g. 2026-12-15).");
    const dt = DateTime.fromISO(trimmed, { zone: ZONE });
    if (!dt.isValid)
        throw new UserError("Invalid calendar date.");
    return dt.toFormat("yyyy-MM-dd");
}
export function isBossDueOnDay(boss, day, intervalTrackingEnabled = false) {
    const type = boss.schedule_type || "daily";
    if (type === "daily")
        return true;
    if (type === "weekly") {
        const valid = normalizeWeekdays(boss.recurrence_days);
        return valid.includes(day.toFormat("ccc").toLowerCase());
    }
    if (type === "event") {
        return Boolean(boss.event_date && day.toFormat("yyyy-MM-dd") === boss.event_date);
    }
    if (type === "interval") {
        return intervalTrackingEnabled;
    }
    return true;
}
export function getNextBossOccurrence(boss, timeStr, nowMs = Date.now(), intervalTrackingEnabled = false) {
    const type = boss.schedule_type || "daily";
    const dayNow = DateTime.fromMillis(nowMs, { zone: ZONE });
    if (type === "event") {
        if (!boss.event_date)
            return null;
        const dt = DateTime.fromFormat(`${boss.event_date} ${timeStr}`, "yyyy-MM-dd HH:mm", {
            zone: ZONE,
        });
        if (!dt.isValid)
            return null;
        const ms = dt.toMillis();
        return ms >= nowMs ? ms : null;
    }
    if (type === "weekly") {
        const validDays = normalizeWeekdays(boss.recurrence_days);
        if (!validDays.length)
            return null;
        for (let offset = 0; offset <= 7; offset++) {
            const candDay = dayNow.plus({ days: offset });
            const dayCode = candDay.toFormat("ccc").toLowerCase();
            if (validDays.includes(dayCode)) {
                const candMs = atTime(candDay, timeStr).toMillis();
                if (candMs >= nowMs)
                    return candMs;
            }
        }
        return null;
    }
    if (type === "interval") {
        const at = boss.estimated_respawn_at;
        return intervalTrackingEnabled && at != null && at >= nowMs ? at : null;
    }
    // Daily
    let cand = atTime(dayNow, timeStr).toMillis();
    if (cand < nowMs) {
        cand = atTime(dayNow.plus({ days: 1 }), timeStr).toMillis();
    }
    return cand;
}
export function nextSpawn(bosses, now, intervalTrackingEnabled = false) {
    const candidates = bosses
        .filter((b) => b.enabled)
        .flatMap((boss) => (boss.schedule_type === "interval" ? ["00:00"] : boss.times).map((time) => {
        const at = getNextBossOccurrence(boss, time, now, intervalTrackingEnabled);
        return at !== null ? { boss, at } : null;
    }))
        .filter((c) => c !== null);
    if (!candidates.length)
        return null;
    const at = Math.min(...candidates.map((c) => c.at));
    return Number.isFinite(at)
        ? { at, bosses: candidates.filter((c) => c.at === at).map((c) => c.boss) }
        : null;
}
export function calculateBossRespawnStatus(boss, latestReport, now = Date.now()) {
    const intervalMinutes = boss.respawn_interval_minutes ?? 0;
    if (!latestReport) {
        return {
            status: "unknown",
            statusLabel: "Unknown",
            lastDefeatedAt: null,
            estimatedRespawnAt: null,
            confirmedAliveAt: null,
        };
    }
    if (latestReport.report_type === "alive") {
        return {
            status: "confirmed_alive",
            statusLabel: "Confirmed Alive",
            lastDefeatedAt: null,
            estimatedRespawnAt: null,
            confirmedAliveAt: latestReport.reported_at,
        };
    }
    const defeatedAt = latestReport.reported_at;
    const estimatedRespawn = intervalMinutes > 0 ? defeatedAt + intervalMinutes * 60_000 : null;
    if (estimatedRespawn === null) {
        return {
            status: "defeated",
            statusLabel: "Defeated",
            lastDefeatedAt: defeatedAt,
            estimatedRespawnAt: null,
            confirmedAliveAt: null,
        };
    }
    if (now < estimatedRespawn) {
        return {
            status: "respawn_pending",
            statusLabel: "Respawn Pending",
            lastDefeatedAt: defeatedAt,
            estimatedRespawnAt: estimatedRespawn,
            confirmedAliveAt: null,
        };
    }
    else {
        return {
            status: "estimated_ready",
            statusLabel: "Estimated Ready",
            lastDefeatedAt: defeatedAt,
            estimatedRespawnAt: estimatedRespawn,
            confirmedAliveAt: null,
        };
    }
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