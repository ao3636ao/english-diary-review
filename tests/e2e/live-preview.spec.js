import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("ルートのライブサーバーでアセットとホーム・日記追加・復習・バックアップが動く", async ({
  page,
}, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL).origin;
  const errors = [];
  const assets = new Map();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && /\.(css|js|svg|png)$/.test(url.pathname)) {
      assets.set(url.pathname, {
        status: response.status(),
        type: response.headers()["content-type"],
      });
    }
  });

  await page.goto(`${origin}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "今日のことばを、",
  );
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(248, 249, 245)",
  );
  await expect(page.locator(".hero")).toHaveCSS(
    "background-color",
    "rgb(25, 63, 54)",
  );
  await expect(page.locator(".bottom-nav")).toHaveCSS("display", "grid");
  expect(
    await page
      .locator(".brand img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await expect.poll(() => assets.get("/styles.css")?.status).toBe(200);
  expect(assets.get("/styles.css").type).toContain("text/css");
  for (const path of [
    "/src/app.js",
    "/src/core.js",
    "/src/db.js",
    "/src/views.js",
  ]) {
    expect(assets.get(path)?.status).toBe(200);
    expect(assets.get(path)?.type).toContain("javascript");
  }
  expect(assets.get("/icons/icon.svg")?.status).toBe(200);
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });

  await page.locator('[data-view="add"]').click();
  await page.getByRole("button", { name: "手入力", exact: true }).click();
  await page
    .locator('[name="study_japanese"]')
    .fill("架空の日記で、青いノートを開いた。");
  await page
    .locator('[name="english"]')
    .fill("I opened a blue notebook in this fictional diary.");
  await page.locator('[name="category"]').selectOption("diary");
  await page.locator('[name="entry_type"]').selectOption("diary");
  await page
    .getByRole("button", { name: "追加内容を確認", exact: true })
    .click();
  await expect(page.locator("#import-preview")).toContainText("新規追加");
  await page.screenshot({
    path: testInfo.outputPath("add-diary.png"),
    fullPage: true,
  });
  const initialDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "追加してバックアップ", exact: true })
    .click();
  const initialBackup = JSON.parse(
    await readFile(await (await initialDownload).path(), "utf8"),
  );
  expect(initialBackup.records).toHaveLength(1);
  expect(initialBackup.records[0]).toMatchObject({
    category: "diary",
    entry_type: "diary",
  });
  await expect(page.locator("#notice")).toContainText(
    "追加・更新データを保存しました",
  );
  await page.getByRole("button", { name: "通知を閉じる" }).click();

  await page.locator('[data-view="home"]').click();
  await expect(page.locator(".metrics .metric").first()).toContainText("1");
  await page
    .getByRole("button", { name: "今日の学習をはじめる", exact: false })
    .click();
  await expect(page.locator("#question")).toHaveText(
    "架空の日記で、青いノートを開いた。",
  );
  await page.getByRole("button", { name: "答えを見る", exact: true }).click();
  await expect(page.locator("#answer")).toContainText(
    "I opened a blue notebook in this fictional diary.",
  );
  await page.screenshot({
    path: testInfo.outputPath("study.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "覚えた", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();

  await page.locator('[data-view="settings"]').click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "設定・バックアップ",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^english-diary-backup-.*\.json$/);
  const backup = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(backup.records).toHaveLength(1);
  expect(backup.progress[0]).toMatchObject({
    correct_count: 1,
    last_result: "remembered",
  });
  await expect(page.locator("#notice")).toContainText(
    "端末への保存完了は確認できません",
  );
  await page.getByRole("button", { name: "通知を閉じる" }).click();
  await page.screenshot({
    path: testInfo.outputPath("backup.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("main")).toContainText("全1件の表現");
  expect(errors).toEqual([]);
});
