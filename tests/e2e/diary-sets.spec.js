import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { diarySets, oneRecord } from "../fixtures.js";

async function db(page) {
  return page.evaluate(async () =>
    (await import("./src/db.js")).readSnapshot(),
  );
}
async function dismiss(page) {
  if (await page.locator("#notice").isVisible())
    await page.getByRole("button", { name: "通知を閉じる" }).click();
}
async function seed(page, rows = diarySets([3])) {
  await page.goto("./#add");
  await page.locator("#import-json").fill(JSON.stringify(rows));
  await page
    .getByRole("button", { name: "追加内容を確認", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "追加してバックアップ", exact: true })
    .click();
  await download;
  await expect(page.locator("#notice")).toContainText("保存しました");
  await dismiss(page);
}
async function select(page, id, value) {
  const config = page.locator(".study-config");
  if (!(await config.evaluate((e) => e.open)))
    await config.locator("summary").first().click();
  await page.locator(`#study-${id}`).selectOption(value);
  await expect
    .poll(async () => (await db(page)).settings.filters[id])
    .toBe(value);
}
async function start(page) {
  const config = page.locator(".study-config");
  if (!(await config.evaluate((e) => e.open)))
    await config.locator("summary").first().click();
  await page.locator('[data-action="start-study"]').click();
  await expect(page.locator("#question")).toBeVisible();
}
async function reveal(page) {
  await page.getByRole("button", { name: "答えを見る", exact: true }).click();
  await expect(page.locator("#answer")).toBeVisible();
}

test("標準モードで2・3・4・5文の日記を順番どおりにまとめて表示し採点する", async ({
  page,
}) => {
  const rows = diarySets();
  await seed(page, rows);
  await page.goto("#study");
  await expect(page.locator("#study-unit")).toHaveValue("auto");
  await expect(page.locator(".study-config summary").first()).toContainText(
    "4日記セット",
  );
  await select(page, "order", "date");
  await start(page);
  for (const [entry, count] of [2, 3, 4, 5].entries()) {
    const expected = rows
      .filter((r) => r.entry_id === `fiction-set-${entry + 1}`)
      .sort((a, b) => a.sentence_no - b.sentence_no);
    await expect(page.locator("#question .diary-japanese")).toHaveText(
      expected.map((r) => r.study_japanese),
    );
    await reveal(page);
    await expect(page.locator(".diary-answer-english")).toHaveText(
      expected.map((r) => r.english),
    );
    await expect(page.locator(".diary-answer")).toHaveCount(count);
    for (const [index, r] of expected.entries()) {
      const answer = page.locator(".diary-answer").nth(index);
      if (r.katakana) await expect(answer).toContainText(r.katakana);
      else
        await expect(
          answer.getByRole("heading", { name: "カタカナ発音" }),
        ).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "セットを覚えた", exact: false })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  const saved = await db(page);
  expect(saved.progress).toHaveLength(14);
  expect(
    saved.progress.every(
      (p) => p.correct_count === 1 && p.incorrect_count === 0,
    ),
  ).toBe(true);
  expect(
    saved.records.every(
      (r) =>
        r.source_metadata.fictional &&
        r.sentence_no === r.source_metadata.position,
    ),
  ).toBe(true);
});

test("日記も従来の1文モードに切り替えられ、選択と文ごとの学習履歴が残る", async ({
  page,
}) => {
  await seed(page);
  await page.goto("#study");
  await select(page, "unit", "sentence");
  await select(page, "order", "date");
  await page.reload();
  await expect(page.locator("#study-unit")).toHaveValue("sentence");
  await expect(page.locator(".study-config summary").first()).toContainText(
    "3件",
  );
  await start(page);
  await expect(page.locator("#question")).toHaveText("架空の日記1：1文目。");
  await expect(page.locator(".diary-card")).toHaveCount(0);
  await reveal(page);
  await page.getByRole("button", { name: "覚えた", exact: false }).click();
  await expect.poll(async () => (await db(page)).progress.length).toBe(1);
  await select(page, "unit", "diary-set");
  await start(page);
  await expect(page.locator("#question .diary-japanese")).toHaveCount(3);
  await reveal(page);
  await page
    .getByRole("button", { name: "セットを覚えた", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  const progress = (await db(page)).progress;
  expect(
    progress.find((p) => p.sentence_id.endsWith("sentence-1")).correct_count,
  ).toBe(2);
  expect(
    progress
      .filter((p) => !p.sentence_id.endsWith("sentence-1"))
      .every((p) => p.correct_count === 1),
  ).toBe(true);
  await page.goto("#library");
  await page.locator("#list-group").selectOption("entry");
  await expect(page.locator(".entry-group")).toHaveCount(1);
  await expect(page.locator(".entry-group .record-japanese")).toHaveText([
    "架空の日記1：1文目。",
    "架空の日記1：2文目。",
    "架空の日記1：3文目。",
  ]);
  const record = page.locator(".record-card").first();
  await record.locator("summary").first().click();
  await record
    .getByRole("button", { name: "日記セットを復習", exact: true })
    .click();
  await expect(page.locator("#question .diary-japanese")).toHaveCount(3);
});

test("旧履歴を保ってセット音読・文別修正・個別採点を記録し、バックアップに保存する", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const store = await import("./src/db.js");
    const core = await import("./src/core.js");
    const s = await store.readSnapshot();
    delete s.settings.filters.unit;
    const p = {
      ...core.grade(
        core.emptyProgress("fiction-set-1-sentence-1"),
        "remembered",
      ),
      correct_count: 5,
      read_aloud_count: 7,
      legacy_note: "keep",
    };
    await store.commit({ ...s, progress: [p] }, s.revision);
  });
  await page.reload();
  await page.goto("#home");
  await page
    .getByRole("button", { name: "日記セットを復習", exact: false })
    .click();
  await reveal(page);
  const second = page.locator(".diary-answer").nth(1);
  await second.locator(".sentence-tools > summary").click();
  await second.locator(".sentence-assessment summary").click();
  await second.locator("[data-sentence-grade]").selectOption("again");
  await page
    .getByRole("button", { name: "セットを音読 ＋1", exact: true })
    .click();
  await expect(page.locator("#read-count-0")).toHaveValue("8");
  await expect(page.locator("#read-count-1")).toHaveValue("1");
  await expect(second.locator(".sentence-tools")).toHaveAttribute("open", "");
  await expect(page.locator("[data-sentence-grade]").nth(1)).toHaveValue(
    "again",
  );
  await dismiss(page);
  await page.locator("#read-count-1").fill("4");
  await page
    .locator(".diary-answer")
    .nth(1)
    .getByRole("button", { name: "回数を保存", exact: true })
    .click();
  await expect(page.locator("#read-count-1")).toHaveValue("4");
  await dismiss(page);
  const beforeAudio = (await db(page)).progress;
  await page.evaluate(() => {
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: "en-US", localService: true }],
        cancel() {},
        speak(s) {
          window.__setAudio = s.text;
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "日記全体を読み上げる", exact: false })
    .click();
  expect(await page.evaluate(() => window.__setAudio)).toBe(
    "Fictional diary 1, sentence 1.\nFictional diary 1, sentence 2.\nFictional diary 1, sentence 3.",
  );
  expect((await db(page)).progress).toEqual(beforeAudio);
  await page
    .getByRole("button", { name: "セットを覚えた", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  await page.goto("#settings");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをバックアップ", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(backup.schema_version).toBe(1);
  expect(
    backup.progress.find((p) => p.sentence_id.endsWith("sentence-1")),
  ).toMatchObject({
    correct_count: 6,
    read_aloud_count: 8,
    legacy_note: "keep",
  });
  expect(
    backup.progress.find((p) => p.sentence_id.endsWith("sentence-2")),
  ).toMatchObject({
    incorrect_count: 1,
    read_aloud_count: 4,
    last_result: "again",
  });
  expect(
    backup.progress.find((p) => p.sentence_id.endsWith("sentence-3")),
  ).toMatchObject({ correct_count: 1, read_aloud_count: 1 });
  expect(backup.records.every((r) => r.source_metadata.fictional)).toBe(true);
  await page.reload();
  expect((await db(page)).progress).toEqual(backup.progress);
});

test("旧schema 1のバックアップを復元すると設定を移行せず日記セットが標準になる", async ({
  page,
}) => {
  await seed(page, [oneRecord()]);
  const original = await page.evaluate(
    async (rows) => {
      const core = await import("./src/core.js");
      const records = rows.map((r) => core.normalizeRecord(r));
      const settings = structuredClone(core.DEFAULT_SETTINGS);
      delete settings.filters.unit;
      const progress = [
        core.setReadCount(
          core.grade(core.emptyProgress(records[0].sentence_id), "again"),
          9,
        ),
      ];
      return core.makeBackup({
        records,
        progress,
        settings,
        categories: ["diary"],
        updated_at: null,
      });
    },
    diarySets([3]).map((r) => ({ ...r, sentence_no: String(r.sentence_no) })),
  );
  await page.goto("#settings");
  await page.getByText("JSONテキストから復元する", { exact: true }).click();
  await page.locator("#restore-json").fill(JSON.stringify(original));
  await page.getByRole("button", { name: "復元内容を確認" }).click();
  await page
    .getByRole("button", { name: "既存データを上書き", exact: true })
    .click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "全データを上書き", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("復元しました");
  const s = await db(page);
  expect(s.records).toHaveLength(3);
  expect(s.progress).toEqual(original.progress);
  expect(s.settings.filters.unit).toBe("auto");
  expect(s.records.every((r) => typeof r.sentence_no === "string")).toBe(true);
  await dismiss(page);
  await page.goto("#study");
  await start(page);
  await expect(page.locator("#question .diary-japanese")).toHaveText([
    "架空の日記1：1文目。",
    "架空の日記1：2文目。",
    "架空の日記1：3文目。",
  ]);
});

test("セット採点中の保存失敗では全履歴を巻き戻し、再操作で1回だけ記録する", async ({
  page,
}) => {
  await seed(page);
  await page.goto("#study");
  await start(page);
  await reveal(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "progress" && ++writes === 2)
        throw new DOMException(
          "Fictional partial write failure",
          "QuotaExceededError",
        );
      return original.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "セットを覚えた", exact: false })
    .click();
  await expect(page.locator('#notice[role="alert"]')).toContainText(
    "保存容量が不足",
  );
  expect((await db(page)).progress).toHaveLength(0);
  expect((await db(page)).records).toHaveLength(3);
  await expect(page.locator(".diary-answer")).toHaveCount(3);
  await dismiss(page);
  await page
    .getByRole("button", { name: "セットを覚えた", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  expect((await db(page)).progress.every((p) => p.correct_count === 1)).toBe(
    true,
  );
});

test("320px幅でセット単位のランダム出題、文順固定、XSS防止が機能する", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  const rows = diarySets().map((r) => ({
    ...r,
    study_japanese: `${r.study_japanese}<img src=x onerror="window.__setXss=1">`,
  }));
  await seed(page, rows);
  await page.goto("#study");
  await page.locator("#study-mode").selectOption("diary-set");
  await expect
    .poll(async () => (await db(page)).settings.filters.unit)
    .toBe("diary-set");
  await start(page);
  const seen = new Set();
  for (let index = 0; index < 4; index++) {
    await expect(page.locator("#question img")).toHaveCount(0);
    await reveal(page);
    const english = await page
      .locator(".diary-answer-english")
      .allTextContents();
    const entry = english[0].match(/diary (\d+)/)[1];
    expect(seen.has(entry)).toBe(false);
    seen.add(entry);
    expect(english).toEqual(
      Array.from(
        { length: english.length },
        (_, i) => `Fictional diary ${entry}, sentence ${i + 1}.`,
      ),
    );
    if (!index) {
      expect(entry).not.toBe("1");
      await page.screenshot({
        path: testInfo.outputPath("diary-set-mobile.png"),
        fullPage: true,
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(await page.evaluate(() => window.__setXss)).toBeUndefined();
    await page
      .getByRole("button", { name: "セットを覚えた", exact: false })
      .click();
  }
  expect(seen.size).toBe(4);
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
});
