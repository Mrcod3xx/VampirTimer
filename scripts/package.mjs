import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const release = join(root, "release");
const stage = join(release, "wispbyte");
if (!existsSync(join(root, "dist/index.js")))
  throw new Error("Run npm run build first.");
mkdirSync(release, { recursive: true });
// Only this generated staging directory is replaced; data/ and .env are never packaged.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
for (const file of [
  "dist",
  "package.json",
  "package-lock.json",
  ".env.example",
  "README.md",
  "DEPLOYMENT.md",
  "RELIABILITY.md",
  "VERIFICATION.md",
  "UPGRADE.md",
])
  cpSync(join(root, file), join(stage, file), { recursive: true });
execFileSync(
  "tar",
  ["-czf", join(release, "wispbyte-boss-tracker.tar.gz"), "-C", stage, "."],
  { stdio: "inherit" },
);
console.log("Runtime package: release/wispbyte-boss-tracker.tar.gz");
