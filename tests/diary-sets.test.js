import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  DEFAULT_SETTINGS,
  normalizeRecord,
  emptyProgress,
  grade,
  selectReviewItems,
  sortDiarySentences,
  gradeReview,
  readReview,
  makeBackup,
  validateBackup,
  parseJSON,
  validateSettings,
} from "../src/core.js";
import { diarySets, oneRecord } from "./fixtures.js";

const filters = (overrides) => ({ ...DEFAULT_SETTINGS.filters, ...overrides });
const records = (lengths = [2, 3, 4, 5]) =>
  diarySets(lengths).map((r) => normalizeRecord(r));

test("標準モードは2・3・4・5文の日記をまとめ、フレーズ・例文・補足を1文ずつ残す", () => {
  const diary = records();
  const extra = ["phrase", "example", "addition"].map((entry_type, i) =>
    normalizeRecord({
      ...oneRecord(),
      entry_type,
      category: i === 0 ? "daily" : "other",
      sentence_id: `extra-${i}`,
      entry_id: diary[0].entry_id,
    }),
  );
  const source = [...diary, ...extra];
  const saved = structuredClone(source);
  const items = selectReviewItems(source, [], filters());
  assert.equal(items.filter((i) => i.type === "diary-set").length, 4);
  assert.equal(items.filter((i) => i.type === "sentence").length, 3);
  assert.deepEqual(
    items
      .filter((i) => i.type === "diary-set")
      .map((i) => i.ids.length)
      .sort(),
    [2, 3, 4, 5],
  );
  assert.equal(new Set(items.flatMap((i) => i.ids)).size, source.length);
  for (const item of items.filter((i) => i.type === "diary-set"))
    assert.deepEqual(
      item.ids,
      diary
        .filter((r) => r.entry_id === item.entry_id)
        .sort((a, b) => a.sentence_no - b.sentence_no)
        .map((r) => r.sentence_id),
    );
  assert.deepEqual(source, saved);
});

test("セットを一様にシャッフルし、出題順が変わってもセット内の文順は固定", () => {
  const source = records();
  let calls = 0;
  const a = selectReviewItems(
    source,
    [],
    filters({ unit: "diary-set" }),
    () => {
      calls++;
      return 0;
    },
  );
  const b = selectReviewItems(
    source,
    [],
    filters({ unit: "diary-set" }),
    () => 0.999,
  );
  assert.equal(calls, 3, "14文ではなく4セットをシャッフルする");
  assert.notDeepEqual(
    a.map((i) => i.entry_id),
    b.map((i) => i.entry_id),
  );
  for (const item of a)
    assert.deepEqual(item.ids, b.find((i) => i.entry_id === item.entry_id).ids);
  assert.deepEqual(
    selectReviewItems(source, [], filters({ order: "date" })).map(
      (i) => i.entry_id,
    ),
    ["fiction-set-1", "fiction-set-2", "fiction-set-3", "fiction-set-4"],
  );
});

test("sentence_noは数値順、番号なし・不正・同番号はIDの自然順で安定表示", () => {
  const row = (sentence_id, sentence_no) => ({
    ...normalizeRecord(oneRecord()),
    sentence_id,
    sentence_no,
  });
  const source = [
    row("missing-10", undefined),
    row("number-10", 10),
    row("number-2", "2"),
    row("missing-2", null),
    row("number-1", 1),
    row("missing-1", "invalid"),
    row("number-2b", 2),
  ];
  const saved = structuredClone(source);
  assert.deepEqual(
    sortDiarySentences(source).map((r) => r.sentence_id),
    [
      "number-1",
      "number-2",
      "number-2b",
      "number-10",
      "missing-1",
      "missing-2",
      "missing-10",
    ],
  );
  assert.deepEqual(source, saved);
});

test("未学習・間違い・カテゴリ・期間の絞り込みでも日記全体を残し、1文モードも使える", () => {
  const source = records([3, 2]);
  const target = source.find(
    (r) => r.sentence_id === "fiction-set-1-sentence-2",
  );
  target.category = "business";
  target.date_jst = "2026-10-18";
  const progress = source
    .filter((r) => r.sentence_id !== target.sentence_id)
    .map((r) => grade(emptyProgress(r.sentence_id), "remembered"));
  for (const f of [
    { status: "unseen" },
    { category: "business" },
    { from: "2026-10-18", to: "2026-10-18" },
  ]) {
    const selected = selectReviewItems(source, progress, filters(f));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].ids.length, 3);
  }
  progress.push(grade(emptyProgress(target.sentence_id), "again"));
  assert.equal(
    selectReviewItems(source, progress, filters({ status: "wrong" }))[0].ids
      .length,
    3,
  );
  assert.deepEqual(
    selectReviewItems(
      source,
      progress,
      filters({ unit: "sentence", status: "wrong" }),
    )[0].ids,
    [target.sentence_id],
  );
  assert.equal(
    selectReviewItems(source, progress, filters({ order: "weak" }))[0].entry_id,
    target.entry_id,
  );
  assert.equal(
    selectReviewItems(source, progress, filters({ unit: "sentence" })).length,
    5,
  );
});

test("セット採点は文ごとに履歴を加算し、個別判定と既存の音読・追加情報を保持", () => {
  const first = {
    ...grade(emptyProgress("a"), "remembered"),
    correct_count: 3,
    read_aloud_count: 7,
    extra: "keep",
  };
  const outside = grade(emptyProgress("outside"), "again");
  const original = [first, outside];
  const saved = structuredClone(original);
  const next = gradeReview(
    original,
    ["a", "b", "c", "a"],
    "remembered",
    new Map([["b", "again"]]),
  );
  assert.equal(next.find((p) => p.sentence_id === "a").correct_count, 4);
  assert.equal(next.find((p) => p.sentence_id === "a").read_aloud_count, 7);
  assert.equal(next.find((p) => p.sentence_id === "a").extra, "keep");
  assert.equal(next.find((p) => p.sentence_id === "b").incorrect_count, 1);
  assert.equal(next.find((p) => p.sentence_id === "c").correct_count, 1);
  assert.deepEqual(
    next.find((p) => p.sentence_id === "outside"),
    outside,
  );
  assert.deepEqual(original, saved);
});

test("セット音読は各文を1回加算し、正誤・最終学習日時は変更しない", () => {
  const original = {
    ...grade(emptyProgress("a"), "again", "2026-10-17T01:00:00Z"),
    read_aloud_count: 7,
  };
  const next = readReview([original], ["a", "b", "a"]);
  assert.equal(next[0].read_aloud_count, 8);
  assert.equal(next[0].incorrect_count, 1);
  assert.equal(next[0].last_reviewed_at, original.last_reviewed_at);
  assert.equal(next[1].read_aloud_count, 1);
  assert.equal(next[1].last_result, null);
  assert.equal(original.read_aloud_count, 7);
});

test("セット途中で回数上限に達しても元の履歴を一部更新しない", () => {
  const original = [
    emptyProgress("a"),
    { ...emptyProgress("b"), correct_count: 1e9, read_aloud_count: 1e9 },
  ];
  const saved = structuredClone(original);
  assert.throws(() => gradeReview(original, ["a", "b"], "remembered"), /上限/);
  assert.throws(() => readReview(original, ["a", "b"]));
  assert.deepEqual(original, saved);
});

test("旧バックアップを標準モードで読み、schema 1とレコード・履歴・追加フィールドを維持", () => {
  const s = {
    records: records([3]),
    progress: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    categories: Object.keys(CATEGORIES),
    updated_at: null,
  };
  s.progress = [grade(emptyProgress(s.records[0].sentence_id), "again")];
  delete s.settings.filters.unit;
  const old = makeBackup(s);
  const restored = validateBackup(parseJSON(JSON.stringify(old)));
  assert.equal(restored.schema_version, 1);
  assert.equal(restored.settings.filters.unit, "auto");
  assert.deepEqual(restored.records, s.records);
  assert.deepEqual(restored.progress, s.progress);
  assert.equal(
    selectReviewItems(
      restored.records,
      restored.progress,
      restored.settings.filters,
    )[0].ids.length,
    3,
  );
  const updated = {
    ...s,
    progress: gradeReview(
      s.progress,
      s.records.map((r) => r.sentence_id),
      "remembered",
    ),
  };
  const roundtrip = validateBackup(
    parseJSON(JSON.stringify(makeBackup(updated))),
  );
  assert.deepEqual(Object.keys(roundtrip).sort(), Object.keys(old).sort());
  assert.deepEqual(roundtrip.records, s.records);
  assert.deepEqual(roundtrip.progress, updated.progress);
  assert.throws(() =>
    validateSettings({
      ...DEFAULT_SETTINGS,
      filters: filters({ unit: "invalid" }),
    }),
  );
});
