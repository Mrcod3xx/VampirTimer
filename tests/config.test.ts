import { expect, it } from "vitest";
import { readConfig } from "../src/config/env.js";
it("rejects missing configuration without exposing a supplied token", () => {
  const token = "SUPER_SECRET_TOKEN_12345";
  expect(() => readConfig({ DISCORD_TOKEN: token })).toThrow(
    "DISCORD_CLIENT_ID",
  );
  try {
    readConfig({ DISCORD_TOKEN: token });
  } catch (error) {
    expect(String(error)).not.toContain(token);
  }
});
it("validates lateness and retention and accepts optional empty guild ID", () => {
  const base = {
    DISCORD_TOKEN: "valid-placeholder-token",
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_GUILD_ID: "",
  };
  expect(readConfig(base).DISCORD_GUILD_ID).toBeUndefined();
  expect(readConfig(base).LATENESS_SECONDS).toBe(120);
  expect(() => readConfig({ ...base, LATENESS_SECONDS: "-1" })).toThrow();
  expect(() => readConfig({ ...base, HISTORY_DAYS: "1000" })).toThrow();
});
