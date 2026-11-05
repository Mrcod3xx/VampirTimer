import { RateLimitError } from "discord.js";

import { displayInstant } from "../utils/time.js";
import { log } from "../utils/logger.js";

export function loginCooldown(error: unknown, attempt: number): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as Record<string, unknown>;
  if (!(error instanceof RateLimitError) && value.status !== 429 && value.name !== "RateLimitError") return null;
  const durations: number[] = [];
  const add = (input: unknown, scale: number) => {
    if (typeof input === "number" && Number.isFinite(input) && input >= 0) durations.push(input * scale);
  };
  // discord.js exposes milliseconds; Discord's raw JSON exposes seconds.
  add(value.timeToReset, 1);
  add(value.retryAfter, 1);
  add(value.retry_after, 1000);
  const raw = value.rawError as Record<string, unknown> | undefined;
  if (raw) add(raw.retry_after, 1000);
  const wait = durations.length ? Math.max(...durations) : Math.min(60_000 * 2 ** Math.min(attempt - 1, 6), 3_600_000);
  return Math.max(20_000, wait + 2000);
}

export async function waitForLoginRetry(deadline: number, signal: AbortSignal,
  report: (remainingSeconds: number) => void,
  now = Date.now,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = (ms, s) => new Promise<void>(resolve => {
    if (s.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); s.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    s.addEventListener("abort", finish, { once: true });
  }),
) {
  while (!signal.aborted && now() < deadline) {
    report(Math.ceil((deadline - now()) / 1000));
    try { await sleep(Math.min(60_000, deadline - now()), signal); }
    catch (error) { if (signal.aborted) return; throw error; }
  }
}

export async function loginWithCooldown(options: {
  login: () => Promise<unknown>; signal: AbortSignal;
  readDeadline: () => number; saveDeadline: (deadline: number) => void;
}) {
  let deadline = options.readDeadline();
  for (let attempt = 1; !options.signal.aborted; attempt++) {
    await waitForLoginRetry(deadline, options.signal, remainingSeconds => {
      log("warn", "Discord login cooldown; next attempt is not a guaranteed unblock time", {
        remainingSeconds, retryAtPhilippineTime: displayInstant(deadline),
      });
    });
    if (options.signal.aborted) return;
    try {
      await options.login();
      options.saveDeadline(0);
      return;
    } catch (error) {
      if (options.signal.aborted) return;
      const wait = loginCooldown(error, attempt);
      if (wait === null) throw error;
      deadline = Date.now() + wait;
      options.saveDeadline(deadline);
      // Persist the cooldown even when the bounded retry sequence ends.
      if (attempt >= 12) throw error;
    }
  }
}

