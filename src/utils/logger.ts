const ranks = { debug: 0, info: 1, warn: 2, error: 3 };
export function log(level: keyof typeof ranks, message: string, data: Record<string, unknown> = {}) {
  const threshold = ranks[(process.env.LOG_LEVEL ?? 'info') as keyof typeof ranks] ?? 1;
  if (ranks[level] < threshold) return;
  // Do not serialize Discord request/error objects: they can contain credentials.
  console.log(JSON.stringify({ time: new Date().toISOString(), level, message, ...data }));
}
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code).slice(0, 60);
  return error instanceof Error ? error.name : 'UnknownError';
}
export class UserError extends Error {}
