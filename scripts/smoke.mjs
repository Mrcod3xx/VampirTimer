import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../dist/database/store.js";
import { Scheduler } from "../dist/services/scheduler.js";
import { createClient } from "../dist/bot/client.js";
import { Views } from "../dist/ui/views.js";
import { Components } from "../dist/ui/components.js";
import { Router } from "../dist/bot/router.js";
import { Notifications } from "../dist/services/notifications.js";
const directory = mkdtempSync(join(tmpdir(), "boss-smoke-"));
const store = new Store(join(directory, "test.db"));
const client = createClient();
try {
  const ids = Array.from({ length: 10 }, (_, i) =>
    String(100000000000000000n + BigInt(i)),
  );
  const now = Date.UTC(2026, 9, 31, 5, 30);
  for (const id of ids) {
    store.initGuild(id, now);
    store.updateSettings(id, { notification_channel_id: "223456789012345678" });
  }
  const router = new Router(
    store,
    new Views(store, new Components(store)),
    new Notifications(store, client),
  );
  let messages = 0;
  const scheduler = new Scheduler(
    store,
    {
      prepare: async () => "223456789012345678",
      send: async () => String(++messages),
    },
    () => ids,
    () => now,
  );
  const start = performance.now();
  await scheduler.tick();
  const elapsed = performance.now() - start;
  await scheduler.tick();
  if (messages !== 10)
    throw new Error(
      `Expected ten grouped messages and no duplicates, received ${messages}`,
    );
  console.log(
    JSON.stringify({
      scenario:
        "10 guilds, two default bosses each, full production modules imported; Discord mocked",
      messages,
      firstTickMs: Math.round(elapsed),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      databaseKB: Math.round(
        (store.db.pragma("page_count", { simple: true }) *
          store.db.pragma("page_size", { simple: true })) /
          1024,
      ),
    }),
  );
} finally {
  client.destroy();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
