import { test, expect } from "@playwright/test";
import { diary181, diarySets, phrases3 } from "../fixtures.js";

async function snapshot(page) {
  return page.evaluate(async () =>
    (await import("./src/db.js")).readSnapshot(),
  );
}
async function seed(page, rows) {
  await page.goto("./#add");
  await page.locator("#import-json").fill(JSON.stringify(rows));
  await page
    .getByRole("button", { name: "追加内容を確認", exact: true })
    .click();
  const file = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "追加してバックアップ", exact: true })
    .click();
  await file;
  await expect(page.locator("#notice")).toContainText("保存しました");
  await page.getByRole("button", { name: "通知を閉じる" }).click();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

for (const width of [320, 393, 768, 1280]) {
  test(`PLAY BACK ${width}px：全画面、2つの復習ボタン、素材の構図と読みやすさ`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const rows = [...diarySets([3, 4]), ...phrases3()];
    await seed(page, rows);
    await page.locator('[data-view="home"]').click();
    await expect(page).toHaveTitle("PLAY BACK — 英語日記・フレーズ復習");
    const logo = page.locator(".brand-wordmark");
    await expect(logo).toHaveAttribute("src", "./assets/playback-wordmark.png");
    await expect(logo).toHaveCSS("filter", "none");
    await expect(page.locator(".app-header")).toHaveCSS(
      "background-color",
      "rgb(0, 0, 0)",
    );
    const dimensions = await logo.evaluate((img) => ({
      natural: [img.naturalWidth, img.naturalHeight],
      ratio:
        img.getBoundingClientRect().width / img.getBoundingClientRect().height,
    }));
    expect(dimensions.natural).toEqual([1086, 699]);
    expect(dimensions.ratio).toBeCloseTo(1086 / 699, 2);
    const hero = page.locator(".hero-image");
    await expect(hero).toHaveAttribute("src", "./assets/hero-grassland.webp");
    await expect(hero).toHaveCSS("object-fit", "contain");
    expect(
      await hero.evaluate((img) => [img.naturalWidth, img.naturalHeight]),
    ).toEqual([1448, 1086]);
    const rect = await hero.boundingBox();
    expect(rect.width / rect.height).toBeCloseTo(4 / 3, 2);
    expect((await page.locator(".hero").textContent()).trim()).toBe("");
    await expect(page.locator("main")).not.toContainText("今日のことばを、");
    await expect(page.locator("main")).not.toContainText("a little,");
    await expect(
      page.getByRole("button", { name: "1文ずつ復習", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "日記セットを復習", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "1文ずつ復習", exact: true })
      .click();
    await expect(page.locator("#question")).toBeVisible();
    await expect(page.locator(".diary-japanese")).toHaveCount(0);
    await expect(page.locator("#answer")).toHaveCount(0);
    expect((await snapshot(page)).settings.filters.unit).toBe("sentence");
    expect(
      parseFloat(
        await page
          .locator("#question")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ),
    ).toBeGreaterThanOrEqual(20);
    await page.getByRole("button", { name: "答えを見る", exact: true }).click();
    await expect(page.locator(".answer-english")).toBeVisible();
    expect(
      parseFloat(
        await page
          .locator(".answer-english")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ),
    ).toBeGreaterThanOrEqual(21);
    await page.getByRole("button", { name: "覚えた", exact: false }).click();
    await expect
      .poll(async () => (await snapshot(page)).progress.length)
      .toBe(1);
    await page.locator('[data-view="home"]').click();
    await page
      .getByRole("button", { name: "日記セットを復習", exact: true })
      .click();
    await expect(page.locator(".diary-card")).toBeVisible();
    expect([3, 4]).toContain(await page.locator(".diary-japanese").count());
    await page.getByRole("button", { name: "答えを見る", exact: true }).click();
    const before = await snapshot(page);
    for (const view of [
      "home",
      "study",
      "library",
      "add",
      "stats",
      "settings",
    ]) {
      await page.locator(`[data-view="${view}"]`).click();
      await expect(page.locator("h1")).toBeVisible();
      await noOverflow(page);
      for (const link of await page.locator(".bottom-nav a").all()) {
        const box = await link.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 393 || width === 1280)
        await page.screenshot({
          path: testInfo.outputPath(`${view}-${width}.png`),
          fullPage: true,
        });
    }
    const after = await snapshot(page);
    expect(after).toEqual(before);
    expect(after.records).toHaveLength(10);
    expect(errors).toEqual([]);
  });
}

test("旧PWAキャッシュから更新しても184文・履歴・音読を保持し、新素材でオフライン動作する", async ({
  page,
  context,
}) => {
  const legacyWorker = `
    self.addEventListener('install',event=>event.waitUntil((async()=>{
      const c=await caches.open('english-diary-review-shell-v2');
      await c.put(new URL('icons/icon-192.png',self.registration.scope),new Response('legacy cache marker'));
      await self.skipWaiting();
    })()));
    self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
  `;
  await context.route("**/sw.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: legacyWorker,
      headers: { "Cache-Control": "no-store" },
    }),
  );
  await seed(page, [...diary181(), ...phrases3()]);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
    const db = await import("./src/db.js");
    const core = await import("./src/core.js");
    const s = await db.readSnapshot();
    const p = core.setReadCount(
      core.grade(core.emptyProgress(s.records[0].sentence_id), "remembered"),
      7,
    );
    await db.commit(
      { ...s, progress: [p], settings: { ...s.settings, speechRate: 0.7 } },
      s.revision,
    );
  });
  await page.reload();
  const before = await snapshot(page);
  expect(before.records).toHaveLength(184);
  expect(await page.evaluate(() => caches.keys())).toContain(
    "english-diary-review-shell-v2",
  );
  await context.unroute("**/sw.js");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await expect(page.locator("#update-banner")).toBeVisible();
  await page.getByRole("button", { name: "更新する", exact: true }).click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page
      .getByRole("button", { name: "更新して再読み込み", exact: true })
      .click(),
  ]);
  await expect(page.locator("h1")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  const state = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open("english-diary-review-shell-playback-v3");
    const urls = (await cache.keys()).map((r) => r.url);
    const response = await fetch("./manifest.webmanifest");
    const manifest = await response.json();
    const db = await (await import("./src/db.js")).openDB();
    return { names, urls, manifest, version: db.version };
  });
  expect(state.names).not.toContain("english-diary-review-shell-v2");
  expect(state.version).toBe(1);
  expect(state.manifest).toMatchObject({
    name: "PLAY BACK",
    short_name: "PLAY BACK",
    id: "./",
    start_url: "./",
    scope: "./",
  });
  expect(state.manifest.icons).toEqual([
    {
      src: "./assets/playback-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "./assets/playback-icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "./assets/playback-icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ]);
  for (const file of [
    "hero-grassland.webp",
    "playback-wordmark.png",
    "playback-icon-192.png",
    "playback-icon-512.png",
    "playback-icon-maskable-512.png",
  ])
    expect(state.urls.some((url) => url.endsWith(`/assets/${file}`))).toBe(
      true,
    );
  await context.setOffline(true);
  await page.goto("http://127.0.0.1:4173/english-diary-review/");
  await expect(
    page.getByRole("heading", { name: "復習", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".brand img")
      .evaluate((img) => img.complete && img.naturalWidth === 1086),
  ).toBe(true);
  expect(
    await page
      .locator(".hero-image")
      .evaluate((img) => img.complete && img.naturalWidth === 1448),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});
