import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { diary181, phrases3, oneRecord } from "../fixtures.js";

async function db(page) {
  return page.evaluate(async () =>
    (await import("./src/db.js")).readSnapshot(),
  );
}
async function importRows(page, rows) {
  await page.goto("#add");
  await page.locator("#import-json").fill(JSON.stringify(rows));
  await page
    .getByRole("button", { name: "追加内容を確認", exact: true })
    .click();
  await expect(page.locator("#import-preview")).toBeVisible();
}
async function commitImport(page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "追加してバックアップ", exact: true })
    .click();
  const file = await download;
  const backup = JSON.parse(await readFile(await file.path(), "utf8"));
  await expect(page.locator("#notice")).toContainText(
    "保存完了は確認できません",
  );
  await page.getByRole("button", { name: "通知を閉じる" }).click();
  return backup;
}
async function seed(page, rows = oneRecord()) {
  await page.goto("./");
  await importRows(page, rows);
  return commitImport(page);
}
async function prepareRestore(page, backup) {
  await page.goto("#settings");
  await page.getByText("JSONテキストから復元する", { exact: true }).click();
  await page.locator("#restore-json").fill(JSON.stringify(backup));
  await page.getByRole("button", { name: "復元内容を確認" }).click();
  await expect(page.locator("#restore-preview")).toBeVisible();
}
async function revealOne(page) {
  await page.goto("#study");
  await page
    .getByRole("button", { name: "この条件で復習する", exact: true })
    .click();
  await page.getByRole("button", { name: "答えを見る", exact: true }).click();
}

test("架空の初期181文をファイルから取り込み、例文と日記を区別", async ({
  page,
}) => {
  await page.goto("./#add");
  await page.locator("#import-file").setInputFiles({
    name: "fictional-diary.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diary181())),
  });
  await expect(page.locator("#import-preview")).toContainText("181");
  const backup = await commitImport(page);
  expect(backup.records).toHaveLength(181);
  expect(backup.records.filter((r) => r.category === "practice")).toHaveLength(
    48,
  );
  expect(backup.records.filter((r) => r.category === "diary")).toHaveLength(
    130,
  );
  expect(backup.records[0].original_source.future_field).toEqual([
    "preserve",
    0,
  ]);
  await page.goto("#study");
  await page.locator("#study-mode").selectOption("practice");
  await expect(page.locator(".study-config summary")).toContainText("48件");
});

test("3文の追加で181→184、同じJSONの再読み込みで重複しない", async ({
  page,
}) => {
  await seed(page, diary181());
  await importRows(page, phrases3());
  let backup = await commitImport(page);
  expect(backup.records).toHaveLength(184);
  await importRows(page, phrases3());
  await expect(page.locator("#import-preview .metric").nth(1)).toContainText(
    "3",
  );
  backup = await commitImport(page);
  expect(backup.records).toHaveLength(184);
  await page.reload();
  expect((await db(page)).records).toHaveLength(184);
});

test("対訳・別表現・自己採点・音読・編集後と再読み込み後の履歴維持", async ({
  page,
}) => {
  await seed(page);
  await revealOne(page);
  await expect(page.locator("#question")).toHaveText(
    oneRecord().study_japanese,
  );
  await expect(page.locator("#answer")).toContainText(oneRecord().english);
  await expect(page.locator("#answer")).toContainText(
    "A fictional alternative.",
  );
  await page.getByRole("button", { name: "音読 ＋1", exact: true }).click();
  await expect(page.locator("#read-count")).toHaveValue("1");
  await page.locator("#read-count").fill("7");
  await page.getByRole("button", { name: "回数を保存", exact: true }).click();
  await page.getByRole("button", { name: "覚えた", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  await page.goto("#library");
  await page.locator(".record-card summary").click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.locator('[name="english"]').fill("A revised fictional sentence.");
  await page.goto("#home");
  await page.goto("#add");
  await expect(page.locator('[name="english"]')).toHaveValue(
    "A revised fictional sentence.",
  );
  await page.locator('[name="category"]').selectOption("business");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page).toHaveURL(/#library$/);
  await page.reload();
  const s = await db(page);
  expect(s.records[0].english).toBe("A revised fictional sentence.");
  expect(s.records[0].extra_source).toEqual({ keep: true });
  expect(s.progress[0]).toMatchObject({
    correct_count: 1,
    incorrect_count: 0,
    read_aloud_count: 7,
    mastery: "mastered",
  });
});

test("IDが同じ更新は確認候補になり、チェックした内容のみ採用", async ({
  page,
}) => {
  await seed(page);
  await importRows(page, {
    sentence_id: "fiction-one",
    english: "A changed fictional expression.",
  });
  await expect(page.locator('[name="update-record"]')).not.toBeChecked();
  await commitImport(page);
  expect((await db(page)).records[0].english).toBe(oneRecord().english);
  await importRows(page, {
    sentence_id: "fiction-one",
    english: "A changed fictional expression.",
  });
  await page.locator('[name="update-record"]').check();
  await commitImport(page);
  expect((await db(page)).records[0].english).toBe(
    "A changed fictional expression.",
  );
});

test("手入力フレーズの追加・検索・まとまり表示・削除確認", async ({ page }) => {
  await page.goto("./#add");
  await page.getByRole("button", { name: "手入力", exact: true }).click();
  await page.locator('[name="study_japanese"]').fill("手入力の架空フレーズ。");
  await page.locator('[name="english"]').fill("A fictional manual phrase.");
  await page.locator('[name="tags"]').fill("架空, テスト");
  await page
    .getByRole("button", { name: "追加内容を確認", exact: true })
    .click();
  await commitImport(page);
  await page.goto("#library");
  await page.locator("#list-search").fill("架空");
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.locator("#list-group").selectOption("entry");
  await expect(page.locator(".entry-group")).toHaveCount(1);
  await page.locator(".record-card summary").click();
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  expect((await db(page)).records).toHaveLength(1);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await page.getByRole("button", { name: "表現と履歴を削除" }).click();
  await expect(page.locator("#notice")).toContainText("削除しました");
  expect((await db(page)).records).toHaveLength(0);
});

test("全データの復元・上書き確認・統合時に同じ履歴を二重加算しない", async ({
  page,
}) => {
  await seed(page);
  await revealOne(page);
  await page.getByRole("button", { name: "音読 ＋1" }).click();
  await page.getByRole("button", { name: "覚えた", exact: false }).click();
  await page.goto("#settings");
  await page.locator("#speech-rate").selectOption("0.7");
  await expect(page.locator("#notice")).toContainText("読み上げ速度を保存");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  await prepareRestore(page, backup);
  await page
    .getByRole("button", { name: "既存データを上書き", exact: true })
    .click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  expect((await db(page)).progress[0].correct_count).toBe(1);
  await page
    .getByRole("button", { name: "既存データを上書き", exact: true })
    .click();
  await page
    .getByRole("button", { name: "全データを上書き", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("復元しました");
  for (let i = 0; i < 2; i++) {
    await prepareRestore(page, backup);
    await page
      .getByRole("button", { name: "既存データと統合", exact: true })
      .click();
    await page.getByRole("button", { name: "統合する", exact: true }).click();
    await expect(page.locator("#notice")).toContainText("統合しました");
  }
  const s = await db(page);
  expect(s.progress).toHaveLength(1);
  expect(s.progress[0]).toMatchObject({
    correct_count: 1,
    read_aloud_count: 1,
  });
  expect(s.settings.speechRate).toBe(0.7);
  expect(s.records[0].extra_source).toEqual({ keep: true });
});

test("新しいブラウザ端末にバックアップファイルから全データを復元", async ({
  page,
  browser,
}) => {
  const backup = await seed(page, diary181());
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto("http://127.0.0.1:4173/english-diary-review/#settings");
  await second.locator("#restore-file").setInputFiles({
    name: "fictional-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(second.locator("#restore-preview")).toBeVisible();
  await second
    .getByRole("button", { name: "既存データを上書き", exact: true })
    .click();
  await second
    .getByRole("button", { name: "全データを上書き", exact: true })
    .click();
  await expect(second.locator("#notice")).toContainText("181件");
  const s = await db(second);
  expect(s.records).toHaveLength(181);
  expect(s.records[0].original_source).toBeDefined();
  await context.close();
});

test("不正JSON・壊れたバックアップでは既存データを変更しない", async ({
  page,
}) => {
  const backup = await seed(page);
  await page.locator("#import-json").fill("{wrong");
  await page.getByRole("button", { name: "追加内容を確認" }).click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "JSONの形式",
  );
  await page.goto("#settings");
  await page.getByText("JSONテキストから復元する", { exact: true }).click();
  await page
    .locator("#restore-json")
    .fill(JSON.stringify({ ...backup, schema_version: 999 }));
  await page.getByRole("button", { name: "復元内容を確認" }).click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "対応するバックアップではありません",
  );
  await expect(page.locator("#restore-preview")).toHaveCount(0);
  expect((await db(page)).records).toHaveLength(1);
});

test("保存の途中失敗はロールバックし、成功表示もダウンロードもしない", async ({
  page,
}) => {
  await seed(page);
  await importRows(page, phrases3());
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "records")
        throw new DOMException("Fictional quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await page.getByRole("button", { name: "追加してバックアップ" }).click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "保存容量が不足",
  );
  const s = await db(page);
  expect(s.records).toHaveLength(1);
  expect(s.records[0].sentence_id).toBe("fiction-one");
  expect(downloaded).toBe(false);
});

test("バックアップ失敗時も保存結果を明示し、再ダウンロードできる", async ({
  page,
}) => {
  await seed(page);
  await importRows(page, phrases3());
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    let first = true;
    URL.createObjectURL = function (...args) {
      if (first) {
        first = false;
        throw new Error("Fictional download failure");
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "追加してバックアップ" }).click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "端末内に保存済み",
  );
  expect((await db(page)).records).toHaveLength(4);
  await expect(page.locator("#backup-status")).toContainText("未バックアップ");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "バックアップを再ダウンロード", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(backup.records).toHaveLength(4);
});

test("カテゴリと復習状態の組み合わせ、セッション内の重複防止", async ({
  page,
}) => {
  await seed(page, phrases3());
  await page.goto("#study");
  await page.locator("#study-category").selectOption("business");
  await expect(page.locator(".study-config summary")).toContainText("1件");
  await page.locator("#study-status").selectOption("unseen");
  await page
    .getByRole("button", { name: "この条件で復習する", exact: true })
    .click();
  await expect(page.locator("#question")).toHaveText(
    phrases3()[1].study_japanese,
  );
  await page.getByRole("button", { name: "答えを見る" }).click();
  await page.getByRole("button", { name: "もう一度", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  await page.locator(".study-config summary").click();
  await page.locator("#study-status").selectOption("wrong");
  await expect(page.locator(".study-config summary")).toContainText("1件");
  expect((await db(page)).progress[0].incorrect_count).toBe(1);
});

test("入力はテキストとして表示し、学習データを外部へ送信しない", async ({
  page,
}) => {
  const external = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173/") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  const injected =
    '<img src="https://example.invalid/private" onerror="window.__xss=1">';
  await seed(page, {
    ...oneRecord(),
    study_japanese: injected,
    explanation: "<script>window.__xss=2</script>",
  });
  await revealOne(page);
  await expect(page.locator("#question")).toHaveText(injected);
  await expect(page.locator("#question img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(external).toEqual([]);
});

test("オンライン音声を使わず、再生を音読として加算しない", async ({ page }) => {
  await seed(page);
  await revealOne(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: "en-US", localService: false }],
        cancel() {},
        speak() {
          window.__spoke = true;
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "英文を読み上げる", exact: false })
    .click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "オンライン音声では読み上げません",
  );
  expect(await page.evaluate(() => window.__spoke)).toBeUndefined();
  expect((await db(page)).progress).toHaveLength(0);
  await page.evaluate(() => {
    speechSynthesis.getVoices = () => [{ lang: "en-US", localService: true }];
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    speechSynthesis.speak = (utterance) => {
      window.__spoke = { text: utterance.text, rate: utterance.rate };
    };
  });
  await page
    .getByRole("button", { name: "英文を読み上げる", exact: false })
    .click();
  expect(await page.evaluate(() => window.__spoke)).toEqual({
    text: oneRecord().english,
    rate: 0.85,
  });
  expect((await db(page)).progress).toHaveLength(0);
});

test("GitHub Pagesのサブパスで起動し、オフライン再読み込みと保存が動作", async ({
  page,
  context,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toBe("http://127.0.0.1:4173/english-diary-review/");
  await context.setOffline(true);
  await page.goto("http://127.0.0.1:4173/english-diary-review/");
  await expect(
    page.getByRole("heading", { name: /今日のことばを、\s*明日の自分へ。/ }),
  ).toBeVisible();
  expect((await db(page)).records).toHaveLength(1);
  await revealOne(page);
  await page.getByRole("button", { name: "覚えた", exact: false }).click();
  expect((await db(page)).progress[0].correct_count).toBe(1);
  await context.setOffline(false);
});

test("保存領域を開けない場合に初期化せず、失敗を明示する", async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException("Fictional access failure", "SecurityError");
    };
  });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "保存領域を開けませんでした" }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("初期化は行っていません");
});

test("同時編集で古い状態を上書きしない", async ({ page }) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { readSnapshot, commit } = await import("./src/db.js");
    const original = await readSnapshot();
    await commit(
      {
        ...original,
        records: original.records.map((r) => ({
          ...r,
          english: "The first saved change.",
        })),
      },
      original.revision,
    );
    try {
      await commit(original, original.revision);
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  });
  expect(result).toContain("別のタブで更新");
  expect((await db(page)).records[0].english).toBe("The first saved change.");
});
