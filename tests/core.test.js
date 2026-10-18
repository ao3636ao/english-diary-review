import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  DEFAULT_SETTINGS,
  normalizeRecord,
  planImport,
  applyImport,
  emptyProgress,
  grade,
  setReadCount,
  selectQuestions,
  summarize,
  parseJSON,
  makeBackup,
  validateBackup,
  mergeBackup,
  jstDate,
  validDate,
  backupFilename,
  validateSettings,
} from "../src/core.js";
import { diary181, phrases3, oneRecord } from "./fixtures.js";

const empty = () => ({
  records: [],
  progress: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  categories: Object.keys(CATEGORIES),
  revision: 0,
  updated_at: null,
  last_backup: null,
});
const imported = () => applyImport(empty(), planImport(diary181(), []));
const filters = (overrides) => ({ ...DEFAULT_SETTINGS.filters, ...overrides });

test("181文を取り込み、130日記・48例文・3補足・発音20を区別する", () => {
  const s = imported();
  assert.equal(s.records.length, 181);
  assert.equal(s.records.filter((r) => r.category === "diary").length, 130);
  assert.equal(s.records.filter((r) => r.category === "practice").length, 48);
  assert.equal(s.records.filter((r) => r.category === "other").length, 3);
  assert.equal(s.records.filter((r) => r.katakana).length, 20);
  assert.deepEqual(s.records[0].original_source, diary181()[0].original_source);
});

test("181文に3文を追加して184文、IDなしの同じJSONを再追加しても重複しない", () => {
  const initial = imported();
  const plan = planImport(phrases3(), initial.records);
  const s = applyImport(initial, plan);
  assert.equal(s.records.length, 184);
  assert.equal(new Set(s.records.map((r) => r.sentence_id)).size, 184);
  assert.ok(plan.every((p) => p.record.entry_id));
  assert.equal(
    planImport(phrases3(), s.records).filter((p) => p.action === "duplicate")
      .length,
    3,
  );
  assert.equal(
    planImport(diary181(), s.records).filter((p) => p.action === "duplicate")
      .length,
    181,
  );
});

test("IDが一致する更新は明示採用するまで実行せず、履歴と追加フィールドを維持する", () => {
  let s = empty();
  s.records = [normalizeRecord(oneRecord())];
  s.progress = [grade(emptyProgress("fiction-one"), "remembered")];
  const plan = planImport(
    { sentence_id: "fiction-one", english: "A revised fictional expression." },
    s.records,
  );
  assert.equal(plan[0].action, "update");
  assert.equal(applyImport(s, plan).records[0].english, s.records[0].english);
  const next = applyImport(s, plan, new Set(["fiction-one"]));
  assert.equal(next.records[0].english, "A revised fictional expression.");
  assert.deepEqual(next.records[0].extra_source, { keep: true });
  assert.deepEqual(next.progress, s.progress);
});

test("同じ英文でも異なる日付・文脈・明示IDなら新規データとして保持する", () => {
  const first = normalizeRecord(oneRecord());
  const { sentence_id, ...raw } = oneRecord();
  assert.equal(
    planImport({ ...raw, date_jst: "2026-10-19" }, [first])[0].action,
    "new",
  );
  assert.equal(
    planImport({ ...raw, entry_id: "different-context" }, [first])[0].action,
    "new",
  );
  assert.equal(
    planImport({ ...raw, sentence_id: "explicit-other" }, [first])[0].action,
    "new",
  );
  assert.equal(planImport(raw, [first])[0].action, "duplicate");
});

test("同一取り込み内の重複・競合を検知し、検証失敗時に元データを変更しない", () => {
  const row = oneRecord();
  assert.deepEqual(
    planImport([row, row], []).map((p) => p.action),
    ["new", "duplicate"],
  );
  assert.throws(
    () => planImport([row, { ...row, english: "Different." }], []),
    /同一ID/,
  );
  const records = [normalizeRecord(row)];
  const saved = structuredClone(records);
  assert.throws(() => planImport([row, { english: "" }], records), /2件目/);
  assert.deepEqual(records, saved);
});

test("未知のカテゴリ・entry_type・安全な文字列やメタデータを保持する", () => {
  const r = normalizeRecord({
    ...oneRecord(),
    category: "future-category",
    entry_type: "future-type",
    katakana: "",
    study_japanese: '<img src=x onerror="alert(1)">',
  });
  assert.equal(r.category, "future-category");
  assert.equal(r.entry_type, "future-type");
  assert.equal(r.study_japanese, '<img src=x onerror="alert(1)">');
  assert.equal(r.katakana, "");
});

test("JSONオブジェクト・配列・コードフェンスを受理し、不正JSON・無効値を拒否", () => {
  assert.equal(
    normalizeRecord({ ...oneRecord(), katakana: null, explanation: null })
      .katakana,
    "",
  );
  assert.deepEqual(parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJSON("{invalid}"), /JSON/);
  for (const patch of [
    { study_japanese: "" },
    { english: 3 },
    { date_jst: "2026-02-30" },
    { alternative_english: [1] },
    { tags: {} },
    { sentence_id: "" },
  ]) {
    assert.throws(() => normalizeRecord({ ...oneRecord(), ...patch }));
  }
  assert.throws(() => planImport([], []), /1〜/);
});

test("JSTの日付と実在日付・日時入りバックアップ名", () => {
  assert.equal(jstDate(new Date("2026-10-18T16:00:00Z")), "2026-10-19");
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(
    backupFilename(new Date("2026-10-18T12:00:01Z")),
    "english-diary-backup-2026-10-18-210001.json",
  );
});

test("自己採点・最終判定・音読回数をそれぞれ更新し、正解率を集計", () => {
  const r = normalizeRecord(oneRecord());
  let p = grade(emptyProgress(r.sentence_id), "again", "2026-10-18T01:00:00Z");
  p = setReadCount(p, 7, "2026-10-18T02:00:00Z");
  p = grade(p, "remembered", "2026-10-18T03:00:00Z");
  assert.equal(p.correct_count, 1);
  assert.equal(p.incorrect_count, 1);
  assert.equal(p.read_aloud_count, 7);
  assert.equal(p.last_result, "remembered");
  assert.equal(p.mastery, "mastered");
  assert.deepEqual(summarize([r], [p]), {
    total: 1,
    studied: 1,
    unseen: 0,
    correct: 1,
    incorrect: 1,
    accuracy: 50,
    weak: 0,
    readAloud: 7,
  });
  assert.throws(() => setReadCount(p, -1));
  assert.throws(() => setReadCount(p, 1.1));
  assert.throws(() => grade(p, "invalid"));
  assert.throws(
    () => grade({ ...p, correct_count: 1e9 }, "remembered"),
    /上限/,
  );
});

test("カテゴリ・未学習・間違い・苦手・期間を組み合わせ、各セッション内で重複しない", () => {
  const s = imported();
  s.progress = [grade(emptyProgress(s.records[0].sentence_id), "again")];
  assert.equal(
    selectQuestions(s.records, s.progress, filters({ category: "diary" }))
      .length,
    130,
  );
  assert.equal(
    selectQuestions(s.records, s.progress, filters({ category: "practice" }))
      .length,
    48,
  );
  assert.equal(
    selectQuestions(s.records, s.progress, filters({ status: "unseen" }))
      .length,
    180,
  );
  assert.equal(
    selectQuestions(
      s.records,
      s.progress,
      filters({ category: "diary", status: "wrong" }),
    ).length,
    1,
  );
  assert.equal(
    selectQuestions(
      s.records,
      s.progress,
      filters({ category: "practice", status: "weak" }),
    ).length,
    0,
  );
  assert.equal(
    selectQuestions(s.records, s.progress, filters({ order: "weak" }))[0]
      .sentence_id,
    s.records[0].sentence_id,
  );
  const ordered = selectQuestions(
    s.records,
    s.progress,
    filters({ from: "2026-09-02", to: "2026-09-03", order: "date" }),
  );
  assert.equal(ordered.length, 18);
  assert.ok(
    ordered.every((r, i) => !i || ordered[i - 1].date_jst <= r.date_jst),
  );
  assert.equal(
    new Set(selectQuestions(s.records, s.progress).map((r) => r.sentence_id))
      .size,
    181,
  );
  assert.throws(() =>
    selectQuestions(
      s.records,
      [],
      filters({ from: "2026-10-20", to: "2026-10-01" }),
    ),
  );
});

test("バックアップは全表現・メタデータ・履歴・設定を損失なく復元できる", () => {
  const s = imported();
  s.progress = [
    setReadCount(
      grade(emptyProgress(s.records[0].sentence_id), "remembered"),
      3,
    ),
  ];
  s.settings.speechRate = 0.7;
  const backup = validateBackup(parseJSON(JSON.stringify(makeBackup(s))));
  assert.deepEqual(backup.records, s.records);
  assert.deepEqual(backup.progress, s.progress);
  assert.deepEqual(backup.settings, s.settings);
  assert.throws(() => planImport(backup, []), /復元/);
});

test("バックアップ構造・バージョン・重複ID・履歴・不正設定を検証", () => {
  const s = imported();
  const b = makeBackup(s);
  const invalid = [
    { schema_version: 999 },
    { records: [b.records[0], b.records[0]] },
    { records: [{ ...b.records[0], sentence_id: undefined }] },
    { progress: [{ ...emptyProgress("unknown") }] },
    {
      progress: [
        { ...emptyProgress(b.records[0].sentence_id), correct_count: -1 },
      ],
    },
    {
      progress: [
        { ...emptyProgress(b.records[0].sentence_id), correct_count: 1 },
      ],
    },
    { settings: { ...DEFAULT_SETTINGS, speechRate: 9 } },
    { created_at: "not-a-time" },
    { categories: [1] },
  ];
  invalid.forEach((patch) =>
    assert.throws(() => validateBackup({ ...b, ...patch })),
  );
  assert.throws(() =>
    validateSettings({ speechRate: 1, filters: { status: "anything" } }),
  );
});

test("統合では履歴を加算せず新しいスナップショットを採用し、内容競合方針を尊重", () => {
  const s = imported();
  const id = s.records[0].sentence_id;
  s.progress = [
    setReadCount(
      grade(emptyProgress(id), "remembered", "2026-10-17T01:00:00Z"),
      3,
      "2026-10-17T02:00:00Z",
    ),
  ];
  const b = makeBackup(s);
  b.records = [{ ...s.records[0], english: "A fictional replacement." }];
  b.progress = [
    setReadCount(
      grade(s.progress[0], "again", "2026-10-18T01:00:00Z"),
      7,
      "2026-10-18T02:00:00Z",
    ),
  ];
  const merged = mergeBackup(s, validateBackup(b));
  assert.equal(merged.records[0].english, s.records[0].english);
  assert.equal(merged.progress[0].read_aloud_count, 7);
  assert.equal(merged.progress[0].correct_count, 1);
  assert.equal(merged.progress[0].incorrect_count, 1);
  assert.deepEqual(mergeBackup(merged, b).progress, merged.progress);
  assert.equal(
    mergeBackup(s, b, { preferBackup: true }).records[0].english,
    b.records[0].english,
  );
});
