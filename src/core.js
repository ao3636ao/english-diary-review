export const FORMAT = "english-diary-review";
export const SCHEMA_VERSION = 1;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_RECORDS = 20000;
export const CATEGORIES = {
  diary: "英語日記",
  daily: "日常フレーズ",
  business: "ビジネス英語",
  practice: "練習例文",
  other: "その他",
};
export const DEFAULT_FILTERS = {
  unit: "auto",
  category: "all",
  status: "all",
  order: "random",
  from: "",
  to: "",
};
export const DEFAULT_SETTINGS = {
  speechRate: 0.85,
  filters: { ...DEFAULT_FILTERS },
};
const fail = (message) => {
  throw new Error(message);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const now = () => new Date().toISOString();

export function jstDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function timestamp(value, name, nullable = false) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !validDate(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(`${name}の日時が不正です。`);
  return value;
}

function text(value, name, { required = false, max = 30000 } = {}) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(
      `${name}は${required ? "空でない" : ""}文字列（${max}文字以内）で指定してください。`,
    );
  return value.trim();
}

function identifier(value, name) {
  if (typeof value === "number" && Number.isSafeInteger(value))
    value = String(value);
  return text(value, name, { required: true, max: 256 });
}

export function newId(prefix = "sentence") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function normalizeRecord(
  raw,
  { defaultDate = jstDate(), idFactory = newId } = {},
) {
  if (!object(raw)) fail("各データはJSONオブジェクトにしてください。");
  const r = { ...raw };
  r.sentence_id =
    raw.sentence_id === undefined
      ? idFactory("sentence")
      : identifier(raw.sentence_id, "sentence_id");
  r.entry_id =
    raw.entry_id === undefined
      ? idFactory("entry")
      : identifier(raw.entry_id, "entry_id");
  r.date_jst = raw.date_jst ?? defaultDate;
  if (!validDate(r.date_jst))
    fail("date_jstは実在する日付（YYYY-MM-DD）で指定してください。");
  r.entry_type = text(raw.entry_type ?? "phrase", "entry_type", {
    required: true,
    max: 100,
  });
  r.category = text(
    raw.category ??
      (r.entry_type === "diary"
        ? "diary"
        : r.entry_type === "example"
          ? "practice"
          : "other"),
    "category",
    { required: true, max: 100 },
  );
  r.study_japanese = text(raw.study_japanese, "study_japanese（日本語）", {
    required: true,
  });
  r.english = text(raw.english, "english（英文）", { required: true });
  r.katakana = text(raw.katakana ?? "", "katakana");
  r.explanation = text(raw.explanation ?? "", "explanation");
  const alternatives = raw.alternative_english ?? [];
  r.alternative_english =
    typeof alternatives === "string" ? [alternatives] : alternatives;
  if (
    !Array.isArray(r.alternative_english) ||
    r.alternative_english.length > 50
  )
    fail(
      "alternative_englishは文字列または50件以内の文字列配列にしてください。",
    );
  r.alternative_english = r.alternative_english
    .map((v) => text(v, "alternative_english"))
    .filter(Boolean);
  const tags = raw.tags ?? [];
  r.tags =
    typeof tags === "string"
      ? tags
          .split(/[,、]/)
          .map((v) => v.trim())
          .filter(Boolean)
      : tags;
  if (!Array.isArray(r.tags) || r.tags.length > 100)
    fail("tagsは100件以内の文字列配列にしてください。");
  r.tags = [
    ...new Set(
      r.tags.map((v) => text(v, "タグ", { required: true, max: 100 })),
    ),
  ];
  return r;
}

export function parseJSON(input) {
  if (typeof input !== "string" || new Blob([input]).size > MAX_FILE_SIZE)
    fail("JSONは10MB以内にしてください。");
  const source = input
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try {
    return JSON.parse(source);
  } catch {
    fail(
      "JSONの形式が正しくありません。括弧・引用符・カンマを確認してください。",
    );
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const same = (a, b) => stable(a) === stable(b);
const naturalKey = (r) =>
  JSON.stringify([
    r.date_jst,
    r.category,
    r.entry_type,
    r.study_japanese,
    r.english,
  ]);

export function planImport(input, existing, options = {}) {
  if (object(input) && input.format === FORMAT)
    fail(
      "これはバックアップです。「設定・バックアップ」から復元してください。",
    );
  const rows = Array.isArray(input) ? input : [input];
  if (!rows.length || rows.length > MAX_RECORDS)
    fail(`1〜${MAX_RECORDS}件のデータを指定してください。`);
  const byId = new Map(existing.map((r) => [r.sentence_id, r]));
  const byContent = new Map();
  for (const r of existing) {
    const key = naturalKey(r);
    byContent.set(key, [...(byContent.get(key) ?? []), r]);
  }
  const seenInputIds = new Set();
  const plan = [];
  for (const [index, raw] of rows.entries()) {
    try {
      if (!object(raw)) fail("JSONオブジェクトにしてください。");
      const hasId = raw.sentence_id !== undefined;
      const id = hasId ? identifier(raw.sentence_id, "sentence_id") : undefined;
      let old = hasId ? byId.get(id) : undefined;
      if (hasId && seenInputIds.has(id)) {
        const previous = plan.find(
          (item) => item.record.sentence_id === id,
        )?.record;
        const candidate = normalizeRecord({ ...previous, ...raw }, options);
        if (!same(previous, candidate))
          fail(
            "同じJSON内で同一IDに異なる内容があります。分けて取り込んでください。",
          );
        plan.push({ action: "duplicate", record: candidate });
        continue;
      }
      if (hasId) seenInputIds.add(id);
      let record = normalizeRecord({ ...old, ...raw }, options);
      if (!hasId) {
        const matches = (byContent.get(naturalKey(record)) ?? []).filter(
          (r) =>
            raw.entry_id === undefined || r.entry_id === String(raw.entry_id),
        );
        if (matches.length > 1)
          fail(
            "同じ内容の候補が複数あります。更新するsentence_idを指定してください。",
          );
        old = matches[0];
        if (old)
          record = normalizeRecord(
            {
              ...old,
              ...raw,
              sentence_id: old.sentence_id,
              entry_id: raw.entry_id ?? old.entry_id,
            },
            options,
          );
      }
      const action = old ? (same(old, record) ? "duplicate" : "update") : "new";
      plan.push({ action, record, before: old });
      if (action === "new") {
        byId.set(record.sentence_id, record);
        const key = naturalKey(record);
        byContent.set(key, [...(byContent.get(key) ?? []), record]);
      }
    } catch (error) {
      fail(`${index + 1}件目: ${error.message}`);
    }
  }
  if (
    existing.length + plan.filter((p) => p.action === "new").length >
    MAX_RECORDS
  )
    fail(`保存できる上限は${MAX_RECORDS}件です。`);
  return plan;
}

export function applyImport(snapshot, plan, selectedUpdates = new Set()) {
  const records = new Map(snapshot.records.map((r) => [r.sentence_id, r]));
  for (const item of plan) {
    if (
      item.action === "new" ||
      (item.action === "update" && selectedUpdates.has(item.record.sentence_id))
    )
      records.set(item.record.sentence_id, item.record);
  }
  return { ...snapshot, records: [...records.values()] };
}

export function emptyProgress(sentence_id) {
  return {
    sentence_id,
    correct_count: 0,
    incorrect_count: 0,
    last_reviewed_at: null,
    last_result: null,
    read_aloud_count: 0,
    mastery: "unseen",
    updated_at: null,
  };
}
export function isWeak(p) {
  return Boolean(
    p && (p.last_result === "again" || p.incorrect_count > p.correct_count),
  );
}
export function grade(progress, result, date = now()) {
  if (!["remembered", "again"].includes(result)) fail("判定が不正です。");
  if (
    (result === "remembered"
      ? progress.correct_count
      : progress.incorrect_count) >= 1e9
  )
    fail(
      "学習回数の保存上限に達しました。現在のデータをバックアップしてください。",
    );
  return {
    ...progress,
    correct_count: progress.correct_count + Number(result === "remembered"),
    incorrect_count: progress.incorrect_count + Number(result === "again"),
    last_reviewed_at: date,
    last_result: result,
    mastery: result === "remembered" ? "mastered" : "learning",
    updated_at: date,
  };
}
export function setReadCount(progress, value, date = now()) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e9)
    fail("音読回数は0〜1,000,000,000の整数で指定してください。");
  return { ...progress, read_aloud_count: value, updated_at: date };
}

function updateProgress(progress, ids, update) {
  const next = new Map(progress.map((p) => [p.sentence_id, p]));
  for (const id of new Set(ids))
    next.set(id, update(next.get(id) ?? emptyProgress(id), id));
  return [...next.values()];
}

export function gradeReview(
  progress,
  ids,
  result,
  overrides = new Map(),
  date = now(),
) {
  return updateProgress(progress, ids, (p, id) =>
    grade(p, overrides.get(id) ?? result, date),
  );
}

export function readReview(progress, ids, date = now()) {
  return updateProgress(progress, ids, (p) =>
    setReadCount(p, p.read_aloud_count + 1, date),
  );
}

export const isDiary = (r) =>
  r.entry_type === "diary" || r.category === "diary";

export function sortDiarySentences(records) {
  const number = (r) => {
    const value = r.sentence_no;
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      String(value).trim() === ""
    )
      return Infinity;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : Infinity;
  };
  return [...records].sort(
    (a, b) =>
      (number(a) === number(b) ? 0 : number(a) < number(b) ? -1 : 1) ||
      a.sentence_id.localeCompare(b.sentence_id, "en", { numeric: true }) ||
      a.sentence_id.localeCompare(b.sentence_id, "en"),
  );
}

function matchingQuestions(records, progress, filters) {
  if (filters.from && filters.to && filters.from > filters.to)
    fail("開始日は終了日以前にしてください。");
  const pmap = new Map(progress.map((p) => [p.sentence_id, p]));
  return records.filter((r) => {
    const p = pmap.get(r.sentence_id) ?? emptyProgress(r.sentence_id);
    return (
      (filters.category === "all" ||
        (filters.category === "practice"
          ? r.entry_type === "example" || r.category === "practice"
          : r.category === filters.category)) &&
      (filters.status === "all" ||
        (filters.status === "unseen" && !p.last_reviewed_at) ||
        (filters.status === "wrong" && p.last_result === "again") ||
        (filters.status === "weak" && isWeak(p))) &&
      (!filters.from || r.date_jst >= filters.from) &&
      (!filters.to || r.date_jst <= filters.to)
    );
  });
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const weakScore = (p) =>
  Number(isWeak(p)) * 1000 +
  (p ? p.incorrect_count / (p.correct_count + p.incorrect_count || 1) : 0);

export function selectReviewItems(
  records,
  progress,
  filters = DEFAULT_FILTERS,
  random = Math.random,
) {
  const unit = filters.unit ?? "auto";
  if (!["auto", "sentence", "diary-set"].includes(unit))
    fail("復習の単位が不正です。");
  const selected = new Set(
    matchingQuestions(records, progress, filters).map((r) => r.sentence_id),
  );
  const groups = new Map();
  for (const r of records) {
    const diary = isDiary(r);
    if (unit === "diary-set" && !diary) continue;
    const group = diary && unit !== "sentence";
    const key = JSON.stringify([
      group ? "diary-set" : "sentence",
      group ? r.entry_id : r.sentence_id,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        type: group ? "diary-set" : "sentence",
        entry_id: r.entry_id,
        records: [],
      });
    groups.get(key).records.push(r);
  }
  const items = [];
  for (const group of groups.values()) {
    if (!group.records.some((r) => selected.has(r.sentence_id))) continue;
    const ordered =
      group.type === "diary-set"
        ? sortDiarySentences(group.records)
        : group.records;
    items.push({
      type: group.type,
      entry_id: group.entry_id,
      ids: ordered.map((r) => r.sentence_id),
    });
  }
  // Shuffle whole sets once: long diaries must not get extra chances to appear first.
  shuffle(items, random);
  const recordMap = new Map(records.map((r) => [r.sentence_id, r]));
  const pmap = new Map(progress.map((p) => [p.sentence_id, p]));
  const date = (item) =>
    item.ids.map((id) => recordMap.get(id).date_jst).sort()[0];
  if (filters.order === "date")
    items.sort(
      (a, b) =>
        date(a).localeCompare(date(b)) ||
        a.ids[0].localeCompare(b.ids[0], "en", { numeric: true }),
    );
  if (filters.order === "weak")
    items.sort(
      (a, b) =>
        Math.max(...b.ids.map((id) => weakScore(pmap.get(id)))) -
        Math.max(...a.ids.map((id) => weakScore(pmap.get(id)))),
    );
  return items;
}

export function selectQuestions(
  records,
  progress,
  filters = DEFAULT_FILTERS,
  random = Math.random,
) {
  const pmap = new Map(progress.map((p) => [p.sentence_id, p]));
  const selected = shuffle(
    matchingQuestions(records, progress, filters),
    random,
  );
  if (filters.order === "date")
    selected.sort(
      (a, b) =>
        a.date_jst.localeCompare(b.date_jst) ||
        a.sentence_id.localeCompare(b.sentence_id),
    );
  if (filters.order === "weak")
    selected.sort((a, b) => {
      const score = (r) => {
        return weakScore(pmap.get(r.sentence_id));
      };
      return score(b) - score(a);
    });
  return selected;
}

export function summarize(records, progress) {
  const ids = new Set(records.map((r) => r.sentence_id));
  const items = progress.filter((p) => ids.has(p.sentence_id));
  const studied = items.filter((p) => p.last_reviewed_at).length;
  const correct = items.reduce((n, p) => n + p.correct_count, 0);
  const incorrect = items.reduce((n, p) => n + p.incorrect_count, 0);
  return {
    total: records.length,
    studied,
    unseen: records.length - studied,
    correct,
    incorrect,
    accuracy:
      correct + incorrect
        ? Math.round((100 * correct) / (correct + incorrect))
        : null,
    weak: items.filter(isWeak).length,
    readAloud: items.reduce((n, p) => n + p.read_aloud_count, 0),
  };
}

export function validateSettings(raw) {
  if (!object(raw)) fail("設定データが不正です。");
  const settings = { ...raw, filters: { ...DEFAULT_FILTERS, ...raw.filters } };
  if (
    typeof settings.speechRate !== "number" ||
    settings.speechRate < 0.5 ||
    settings.speechRate > 1.5
  )
    fail("読み上げ速度が不正です。");
  const f = settings.filters;
  if (
    typeof f.category !== "string" ||
    f.category.length > 100 ||
    !["all", "unseen", "wrong", "weak"].includes(f.status) ||
    !["random", "date", "weak"].includes(f.order) ||
    !["auto", "sentence", "diary-set"].includes(f.unit)
  )
    fail("出題設定が不正です。");
  if (
    (f.from && !validDate(f.from)) ||
    (f.to && !validDate(f.to)) ||
    (f.from && f.to && f.from > f.to)
  )
    fail("出題期間が不正です。");
  return settings;
}

function validateProgress(p, ids) {
  if (
    !object(p) ||
    typeof p.sentence_id !== "string" ||
    !ids.has(p.sentence_id)
  )
    fail("学習履歴に対応する問題がありません。");
  for (const key of ["correct_count", "incorrect_count", "read_aloud_count"])
    if (!Number.isSafeInteger(p[key]) || p[key] < 0 || p[key] > 1e9)
      fail("学習回数が不正です。");
  timestamp(p.last_reviewed_at, "最終学習", true);
  timestamp(p.updated_at, "学習履歴の更新", true);
  if (
    ![null, "remembered", "again"].includes(p.last_result) ||
    !["unseen", "learning", "mastered"].includes(p.mastery)
  )
    fail("学習状態が不正です。");
  if (
    (p.last_reviewed_at === null) !== (p.last_result === null) ||
    (p.last_reviewed_at === null &&
      (p.correct_count + p.incorrect_count > 0 || p.mastery !== "unseen")) ||
    (p.last_reviewed_at !== null &&
      (p.correct_count + p.incorrect_count === 0 || p.mastery === "unseen"))
  )
    fail("学習状態と回数・日時が一致しません。");
  if (
    (p.last_result === "remembered" &&
      (p.correct_count === 0 || p.mastery !== "mastered")) ||
    (p.last_result === "again" &&
      (p.incorrect_count === 0 || p.mastery !== "learning")) ||
    (p.last_reviewed_at !== null && p.updated_at === null)
  )
    fail("最終判定と学習状態が一致しません。");
  return { ...p };
}

export function makeBackup(snapshot, created_at = now()) {
  return {
    format: FORMAT,
    schema_version: SCHEMA_VERSION,
    created_at,
    updated_at: snapshot.updated_at,
    categories: [
      ...new Set([
        ...Object.keys(CATEGORIES),
        ...snapshot.categories,
        ...snapshot.records.map((r) => r.category),
      ]),
    ],
    records: snapshot.records,
    progress: snapshot.progress,
    settings: snapshot.settings,
  };
}

export function validateBackup(input) {
  if (
    !object(input) ||
    input.format !== FORMAT ||
    input.schema_version !== SCHEMA_VERSION
  )
    fail(
      "対応するバックアップではありません。形式とスキーマバージョンを確認してください。",
    );
  timestamp(input.created_at, "バックアップ作成");
  timestamp(input.updated_at, "データ更新", true);
  if (
    !Array.isArray(input.records) ||
    input.records.length > MAX_RECORDS ||
    !Array.isArray(input.progress) ||
    !Array.isArray(input.categories)
  )
    fail("バックアップの配列が不正です。");
  const ids = new Set();
  const records = input.records.map((r) => {
    if (
      !object(r) ||
      r.sentence_id === undefined ||
      r.entry_id === undefined ||
      !validDate(r.date_jst)
    )
      fail("バックアップのIDまたは日付が欠落しています。");
    const record = normalizeRecord(r);
    if (ids.has(record.sentence_id))
      fail("バックアップに重複するIDがあります。");
    ids.add(record.sentence_id);
    return record;
  });
  const pids = new Set();
  const progress = input.progress.map((p) => {
    const item = validateProgress(p, ids);
    if (pids.has(item.sentence_id)) fail("学習履歴のIDが重複しています。");
    pids.add(item.sentence_id);
    return item;
  });
  if (
    input.categories.length > 1000 ||
    input.categories.some(
      (c) => typeof c !== "string" || !c.trim() || c.length > 100,
    )
  )
    fail("カテゴリが不正です。");
  return {
    ...input,
    records,
    progress,
    settings: validateSettings(input.settings),
    categories: [...new Set(input.categories)],
  };
}

export function mergeBackup(
  snapshot,
  backup,
  { preferBackup = false, restoreSettings = false } = {},
) {
  const records = new Map(snapshot.records.map((r) => [r.sentence_id, r]));
  for (const r of backup.records)
    if (!records.has(r.sentence_id) || preferBackup)
      records.set(r.sentence_id, r);
  if (records.size > MAX_RECORDS)
    fail(`統合後のデータが上限${MAX_RECORDS}件を超えます。`);
  const progress = new Map(snapshot.progress.map((p) => [p.sentence_id, p]));
  for (const p of backup.progress) {
    const old = progress.get(p.sentence_id);
    const changed = (row) =>
      Date.parse(
        row.updated_at ?? row.last_reviewed_at ?? "1970-01-01T00:00:00Z",
      );
    if (
      !old ||
      changed(p) > changed(old) ||
      (changed(p) === changed(old) && preferBackup)
    )
      progress.set(p.sentence_id, p);
  }
  return {
    ...snapshot,
    records: [...records.values()],
    progress: [...progress.values()],
    categories: [...new Set([...snapshot.categories, ...backup.categories])],
    settings: restoreSettings ? backup.settings : snapshot.settings,
  };
}

export function backupFilename(date = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll(":", "");
  return `english-diary-backup-${jstDate(date)}-${time}.json`;
}
