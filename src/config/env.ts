import 'dotenv/config';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/);
export const environment = z.object({
  DISCORD_TOKEN: z.string().min(20),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_ID: z.preprocess(v => v === '' ? undefined : v, snowflake.optional()),
  DATABASE_PATH: z.string().min(1).default('./data/boss-tracker.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LATENESS_SECONDS: z.coerce.number().int().min(10).max(300).default(120),
  HISTORY_DAYS: z.coerce.number().int().min(7).max(90).default(30),
});
export function readConfig(input = process.env) {
  const result = environment.safeParse(input);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}. See .env.example.`);
  return result.data;
}
