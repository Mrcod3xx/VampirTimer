import { DateTime } from 'luxon';
import { UserError } from './logger.js';

export const ZONE = 'Asia/Manila';
export const zoneLabel = 'Philippine Time · Asia/Manila (UTC+8)';
export function parseTimes(input: string): string[] {
  const parts = input.split(',').map(s => s.trim());
  if (!parts.length || parts.length > 12) throw new UserError('Enter 1–12 comma-separated daily times.');
  return [...new Set(parts.map(value => {
    const twelve = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(value);
    if (twelve) return `${String(Number(twelve[1]) % 12 + (twelve[3]!.toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${twelve[2]}`;
    const twentyFour = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (twentyFour) return `${twentyFour[1]!.padStart(2, '0')}:${twentyFour[2]}`;
    throw new UserError(`Invalid time "${value.slice(0, 30)}". Use 2:00 PM or 14:00.`);
  }))].sort();
}
export function formatTime(time: string) {
  return DateTime.fromFormat(time, 'HH:mm', { zone: ZONE, locale: 'en' }).toFormat('h:mm a');
}
export function atTime(day: DateTime, time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return day.setZone(ZONE).startOf('day').set({ hour, minute });
}
export function displayInstant(ms: number) {
  return DateTime.fromMillis(ms, { zone: ZONE, locale: 'en' }).toFormat('ccc, LLL d · h:mm a');
}
export interface TimedBoss { id: number; name: string; enabled: number; times: string[] }
export function nextSpawn(bosses: TimedBoss[], now: number) {
  const day = DateTime.fromMillis(now, { zone: ZONE });
  const candidates = bosses.filter(b => b.enabled).flatMap(boss => boss.times.map(time => {
    let at = atTime(day, time);
    if (at.toMillis() < now) at = at.plus({ days: 1 });
    return { boss, at: at.toMillis() };
  }));
  const at = Math.min(...candidates.map(c => c.at));
  return Number.isFinite(at) ? { at, bosses: candidates.filter(c => c.at === at).map(c => c.boss) } : null;
}
