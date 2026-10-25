import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("ロゴ・草原・PWAアイコンはユーザー提供ZIPの元バイトを保持する", async () => {
  const expected = {
    "hero-grassland.webp":
      "3d635c239379681d134e0c1b2d5d39d550222227a31d8106948208b75dfc62dc",
    "playback-wordmark.png":
      "bbb3b9f406332e8d673bb1b190363b51ac0dec9b10dec587827fc05d440fade0",
    "playback-icon-96.png":
      "4d2539ca309e766215745dfaa8e138fd7e967f5f2e04e3a8c74d532187eb891f",
    "playback-icon-192.png":
      "fdf47370b684053837409a01cc9440f801df60bf259468e07609f668f9db73d0",
    "playback-icon-512.png":
      "671bfb34aaeb6e48b19de906fdbd6ffa82b5007b5f0e1a564201e9347aa12fbd",
    "playback-icon-maskable-512.png":
      "3192c837cfe7980e1a747b9b2497052b90801d4645302dffb43cd819993e4027",
  };
  for (const [name, hash] of Object.entries(expected)) {
    const bytes = await readFile(new URL(`../assets/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  }
});
