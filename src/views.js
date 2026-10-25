import {
  CATEGORIES,
  emptyProgress,
  isWeak,
  summarize,
  selectReviewItems,
  sortDiarySentences,
  isDiary,
  jstDate,
  same,
} from "./core.js";

export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const categoryName = (key) =>
  Object.hasOwn(CATEGORIES, key) ? CATEGORIES[key] : key;
export function displayTime(value) {
  return value
    ? new Date(value).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "まだありません";
}
const options = (items, selected) =>
  items
    .map(
      ([value, label]) =>
        `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`,
    )
    .join("");
const categories = (state) =>
  [
    ...new Set([
      ...Object.keys(CATEGORIES),
      ...state.categories,
      ...state.records.map((r) => r.category),
    ]),
  ].map((key) => [key, categoryName(key)]);
const categoryOptions = (state, selected, all = true) =>
  options(
    [...(all ? [["all", "すべてのカテゴリ"]] : []), ...categories(state)],
    selected,
  );
const heading = (eyebrow, title, description = "") =>
  `<div class="page-heading"><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1>${description ? `<p class="muted">${escape(description)}</p>` : ""}</div>`;
const badge = (r) =>
  `<span class="badge">${escape(categoryName(r.category))}</span>${r.entry_type === "example" ? '<span class="badge pale">練習例文</span>' : r.entry_type === "addition" ? '<span class="badge pale">補足表現</span>' : ""}`;
const metric = (value, label) =>
  `<div class="metric"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
const empty = (
  title,
  description,
  action = '<a class="button" href="#add">表現を追加する</a>',
) =>
  `<div class="empty-state"><span class="empty-icon" aria-hidden="true">▤</span><h2>${escape(title)}</h2><p>${escape(description)}</p>${action}</div>`;
const pFor = (state, id) =>
  state.progress.find((p) => p.sentence_id === id) ?? emptyProgress(id);
const alternatives = (r) =>
  r.alternative_english?.length
    ? `<div class="answer-section"><h3>別の自然な英訳</h3>${r.alternative_english.map((a) => `<p lang="en" class="preserve english">${escape(a)}</p>`).join("")}</div>`
    : "";
const notes = (r) =>
  `${r.katakana ? `<div class="answer-section"><h3>カタカナ発音</h3><p class="preserve">${escape(r.katakana)}</p></div>` : ""}${r.explanation ? `<div class="answer-section"><h3>解説・補足</h3><p class="preserve">${escape(r.explanation)}</p></div>` : ""}${alternatives(r)}${typeof r.mapping_note === "string" && r.mapping_note ? `<details class="source-note"><summary>元データの補足</summary><p class="preserve">${escape(r.mapping_note)}</p>${typeof r.japanese_provenance === "string" ? `<p class="muted">出典区分：${escape(r.japanese_provenance)}</p>` : ""}</details>` : ""}`;

export function home(state) {
  const s = summarize(state.records, state.progress);
  const recent = state.progress
    .filter((p) => p.last_reviewed_at)
    .sort((a, b) => b.last_reviewed_at.localeCompare(a.last_reviewed_at))
    .slice(0, 4);
  const today = state.progress.filter(
    (p) =>
      p.last_reviewed_at && jstDate(new Date(p.last_reviewed_at)) === jstDate(),
  ).length;
  return `<section class="home-overview" aria-label="ホーム"><figure class="hero"><img class="hero-image" src="./assets/hero-grassland.webp" alt="青空と草原の中に立つ少年とバイク" width="1448" height="1086" fetchpriority="high"></figure><div class="home-controls"><div class="section-title home-title"><h1>復習</h1><span class="today-count">今日 ${today}文</span></div><div class="primary-actions"><button class="button review-action sentence-action" data-action="start-sentence-study" aria-label="1文ずつ復習"><span>1文ずつ復習</span><span aria-hidden="true">→</span></button><button class="button review-action diary-action" data-action="start-diary-study" aria-label="日記セットを復習"><span>日記セットを復習</span><span aria-hidden="true">→</span></button></div><section class="metrics home-metrics" aria-label="学習の概要">${metric(s.total, "登録文数")}${metric(s.studied, "学習済み")}${metric(s.readAloud, "音読回数")}</section><dl class="home-counts"><div><dt>未学習</dt><dd>${s.unseen}文</dd></div><div><dt>苦手な問題</dt><dd>${s.weak}文</dd></div></dl></div></section>
    <div class="home-details two-columns"><section class="panel"><div class="section-title"><h2>最近の学習</h2><a href="#stats">学習記録 →</a></div>${
      recent.length
        ? `<ul class="recent-list">${recent
            .map((p) => {
              const r = state.records.find(
                (r) => r.sentence_id === p.sentence_id,
              );
              return r
                ? `<li><div><p>${escape(r.study_japanese)}</p><small>${escape(displayTime(p.last_reviewed_at))}</small></div><span class="badge ${p.last_result === "again" ? "amber" : ""}">${p.last_result === "again" ? "もう一度" : "覚えた"}</span></li>`
                : "";
            })
            .join("")}</ul>`
        : '<p class="muted">学習記録はまだありません。</p>'
    }</section><section class="panel soft home-data"><h2>${s.total ? "追加・バックアップ" : "学習データを追加"}</h2><p>${s.total ? "JSON・手入力での追加と、全データのバックアップ。" : "初期データのJSONファイル、ChatGPTのJSON、手入力から登録できます。"}</p><div class="actions"><a class="button secondary" href="#add">${s.total ? "表現を追加" : "JSONを読み込む"}</a><button class="button secondary" data-action="backup">バックアップ</button></div></section></div><p class="privacy-note">データは端末内に保存 · ログイン不要 · 広告なし</p>`;
}

function readCounter(r, p, inputId = "read-count") {
  return `<div class="read-counter"><label>自分で音読した回数<input id="${inputId}" type="number" min="0" max="1000000000" step="1" value="${p.read_aloud_count}" inputmode="numeric"></label><button class="button secondary small" data-action="set-read" data-id="${escape(r.sentence_id)}" data-read-input="${inputId}">回数を保存</button><button class="button secondary small" data-action="add-read" data-id="${escape(r.sentence_id)}">音読 ＋1</button></div>`;
}

function gradeButtons(set = false) {
  return `<div class="grade-buttons"><button class="button secondary" data-action="grade-again">${set ? "セットをもう一度" : "もう一度"}</button><button class="button" data-action="grade-remembered">${set ? "セットを覚えた" : "覚えた"} <span aria-hidden="true">✓</span></button></div>`;
}

function diaryCard(state, ui, records) {
  const session = ui.session;
  return `<section class="study-card diary-card" aria-label="日記セットの復習問題"><div class="study-top"><span class="eyebrow">DIARY SET ${session.index + 1} / ${session.items.length}</span><span class="badge">${records.length}文の日記セット</span></div><p class="fine">${escape(records[0].date_jst)} · 順番どおりに、ひとつの話を英語に。</p><div id="question" class="diary-questions"><ol>${records.map((r) => `<li class="diary-japanese"><p>${escape(r.study_japanese)}</p></li>`).join("")}</ol></div>
    ${
      !ui.answer
        ? '<p class="muted">日記全体を英語で考えて、声に出してみましょう。</p><button class="button wide" data-action="reveal">答えを見る</button>'
        : `<div id="answer" class="answer"><p class="eyebrow">DIARY ANSWER</p><div class="set-actions"><button class="button secondary" data-action="speak-set" aria-label="日記全体を読み上げる">日記を読み上げる ▷</button><button class="button secondary" data-action="add-read-set">セットを音読 ＋1</button></div><p class="fine">音読 ＋1は各文の音読回数に加算します。音声再生だけでは加算しません。</p><ol class="diary-answers">${records
            .map(
              (r, index) =>
                `<li class="diary-answer" data-sentence-id="${escape(r.sentence_id)}"><h3>${index + 1}文目</h3><p class="english answer-english diary-answer-english" lang="en">${escape(r.english)}</p>${notes(r)}<details class="sentence-tools" data-sentence-tools="${escape(r.sentence_id)}"${session.tools.has(r.sentence_id) || session.grades.has(r.sentence_id) ? " open" : ""}><summary>音読 ${pFor(state, r.sentence_id).read_aloud_count}回・文ごとの操作</summary><button class="button secondary small" data-action="speak" data-id="${escape(r.sentence_id)}">この文を読み上げる ▷</button>${readCounter(r, pFor(state, r.sentence_id), `read-count-${index}`)}<details class="sentence-assessment"${session.grades.has(r.sentence_id) ? " open" : ""}><summary>この文だけ判定を変える</summary><label>${index + 1}文目の自己採点<select data-sentence-grade="${escape(r.sentence_id)}">${options(
                  [
                    ["", "セットと同じ"],
                    ["remembered", "覚えた"],
                    ["again", "もう一度"],
                  ],
                  session.grades.get(r.sentence_id) ?? "",
                )}</select></label></details></details></li>`,
            )
            .join(
              "",
            )}</ol><p class="fine">セット全体を自己採点して次へ。個別に選んだ文は、その判定を優先します。履歴は文ごとに保存します。</p>${gradeButtons(true)}</div>`
    }</section>`;
}

export function study(state, ui) {
  const filters = state.settings.filters;
  let items = [];
  try {
    items = selectReviewItems(state.records, state.progress, filters);
  } catch {
    /* form displays range validation */
  }
  const sets = items.filter((item) => item.type === "diary-set").length;
  const sentenceCount = items.reduce(
    (count, item) => count + item.ids.length,
    0,
  );
  const countLabel = sets
    ? `${sets}日記セット${items.length > sets ? `・${items.length - sets}文` : ""}（全${sentenceCount}文）が対象`
    : `${items.length}件が対象`;
  const config = `<details class="panel study-config"${(ui.studyConfigOpen ?? !ui.session) ? " open" : ""}><summary>出題設定 <span class="muted">${countLabel}</span></summary><div class="form-grid">
    <label class="full">復習の単位<select id="study-unit">${options(
      [
        ["auto", "標準：日記はセット、フレーズは1文"],
        ["diary-set", "日記セット復習（日記のみ）"],
        ["sentence", "1文ずつ復習（従来のモード）"],
      ],
      filters.unit ?? "auto",
    )}</select></label>
    <label class="full">かんたんモード<select id="study-mode">${options(
      [
        ["all", "すべてランダム"],
        ["diary-set", "日記セット復習（おすすめ）"],
        ["diary", "英語日記のみ"],
        ["daily", "日常フレーズのみ"],
        ["business", "ビジネス英語のみ"],
        ["practice", "練習例文のみ"],
        ["unseen", "未学習のみ"],
        ["wrong", "間違えた問題のみ"],
        ["weak", "苦手な問題を優先"],
        ["date", "日付順"],
        ["period", "指定期間"],
        ["custom", "組み合わせて絞り込み"],
      ],
      ui.mode ?? "custom",
    )}</select></label>
    <label>カテゴリ<select id="study-category">${categoryOptions(state, filters.category)}</select></label>
    <label>復習状態<select id="study-status">${options(
      [
        ["all", "すべての状態"],
        ["unseen", "未学習"],
        ["wrong", "前回「もう一度」"],
        ["weak", "苦手な問題"],
      ],
      filters.status,
    )}</select></label>
    <label>出題順<select id="study-order">${options(
      [
        ["random", "ランダム"],
        ["weak", "苦手な問題を優先"],
        ["date", "日付順（古い順）"],
      ],
      filters.order,
    )}</select></label>
    <div></div><label>開始日<input id="study-from" type="date" value="${escape(filters.from)}"></label><label>終了日<input id="study-to" type="date" value="${escape(filters.to)}"></label></div>
    <button class="button" data-action="start-study">${ui.session ? "この条件で新しくはじめる" : "この条件で復習する"}</button><p class="fine">日記セットは条件に合う文が1つでもあれば、日記全体を出題します。セット内は文番号順、番号がない文はIDの自然順です。1回の復習で同じセットは繰り返しません。条件の変更は次に復習をはじめると適用されます。</p></details>`;
  let content;
  const session = ui.session;
  if (!session)
    content = empty(
      "出題設定を選択",
      "日本語を見たら英語を考えて、答えを確認。最後に自分で採点します。",
      "",
    );
  else if (session.index >= session.items.length)
    content = `<section class="panel session-finished"><p class="eyebrow">SESSION COMPLETE</p><h2>おつかれさまでした。</h2><p>${session.items.length}件（全${session.items.reduce((n, item) => n + item.ids.length, 0)}文）の復習が終わりました。</p><div class="metrics">${metric(session.remembered, "覚えた文")}${metric(session.again, "もう一度の文")}</div><button class="button" data-action="start-study">もう一度、復習する</button><a class="button secondary" href="#home">ホームへ</a></section>`;
  else {
    const item = session.items[session.index];
    const id = item.ids[0];
    const r = state.records.find((r) => r.sentence_id === id);
    const records = item.ids.map((id) =>
      state.records.find((r) => r.sentence_id === id),
    );
    if (records.some((r) => !r))
      return (
        heading("PRACTICE", "復習する") +
        config +
        empty(
          "出題データが変更されました",
          "出題設定から復習をはじめ直してください。",
          "",
        )
      );
    if (item.type === "diary-set") content = diaryCard(state, ui, records);
    else
      content = `<section class="study-card" aria-label="復習問題"><div class="study-top"><span class="eyebrow">QUESTION ${session.index + 1} / ${session.items.length}</span>${badge(r)}</div><p class="fine">${escape(r.date_jst)} · 日本語を英語にしてみましょう</p><h2 id="question" class="question ${r.study_japanese.length > 100 ? "long" : ""}">${escape(r.study_japanese)}</h2>
      ${!ui.answer ? '<p class="muted">まずは自分で考えて、声に出してみてください。</p><button class="button wide" data-action="reveal">答えを見る</button>' : `<div id="answer" class="answer"><p class="eyebrow">ANSWER</p><p class="english answer-english" lang="en">${escape(r.english)}</p><button class="button secondary" data-action="speak" data-id="${escape(id)}">英文を読み上げる <span aria-hidden="true">▷</span></button><p class="fine">端末内の英語音声を使用 · 再生だけでは音読回数に加算しません</p>${notes(r)}${readCounter(r, pFor(state, id))}<p class="fine">思い出せましたか？ 自分で採点して、次の問題へ。</p>${gradeButtons()}</div>`}</section>`;
  }
  return (
    heading(
      "PRACTICE",
      "復習する",
      "日本語から英文を思い出し、答えを確認して自己採点します。",
    ) +
    config +
    content
  );
}

export function library(state, ui) {
  return (
    heading(
      "LIBRARY",
      "日記・フレーズ一覧",
      "登録した日記・フレーズを検索、編集できます。",
    ) +
    `<section class="panel"><div class="library-toolbar"><label class="search-label">検索<input id="list-search" type="search" placeholder="日本語・英語・タグで検索" value="${escape(ui.list.query)}"></label><label>カテゴリ<select id="list-category">${categoryOptions(state, ui.list.category)}</select></label><label>表示単位<select id="list-group">${options(
      [
        ["sentence", "フレーズ単位"],
        ["entry", "日記・まとまり単位"],
      ],
      ui.list.group,
    )}</select></label></div><div id="library-results">${libraryResults(state, ui)}</div></section>`
  );
}

function recordCard(r, state) {
  const p = pFor(state, r.sentence_id);
  return `<details class="record-card"><summary><span class="record-meta">${escape(r.date_jst)} ${badge(r)}${p.last_reviewed_at ? `<span class="progress-dot ${isWeak(p) ? "weak" : ""}">${isWeak(p) ? "もう一度" : "学習済み"}</span>` : ""}</span><span class="record-japanese">${escape(r.study_japanese)}</span><span class="record-english" lang="en">${escape(r.english)}</span></summary><div class="record-detail">${notes(r)}${r.tags?.length ? `<p class="tag-list">${r.tags.map((t) => `<span>#${escape(t)}</span>`).join(" ")}</p>` : ""}<p class="fine">正解 ${p.correct_count}回 · もう一度 ${p.incorrect_count}回 · 音読 ${p.read_aloud_count}回</p><p class="fine">元データの種類：${escape(r.entry_type)} · ID：${escape(r.sentence_id)}</p><div class="actions"><button class="button secondary small" data-action="study-one" data-id="${escape(r.sentence_id)}">この表現を復習</button>${isDiary(r) ? `<button class="button secondary small" data-action="study-entry" data-id="${escape(r.sentence_id)}">日記セットを復習</button>` : ""}<button class="button secondary small" data-action="edit" data-id="${escape(r.sentence_id)}">編集</button><button class="button text-danger small" data-action="delete" data-id="${escape(r.sentence_id)}">削除</button></div></div></details>`;
}

export function libraryResults(state, ui) {
  const search = ui.list.query.toLocaleLowerCase();
  const records = state.records
    .filter(
      (r) =>
        (ui.list.category === "all" || r.category === ui.list.category) &&
        (!search ||
          [
            r.study_japanese,
            r.english,
            r.katakana,
            r.explanation,
            ...(r.alternative_english ?? []),
            ...(r.tags ?? []),
          ].some((s) => s?.toLocaleLowerCase().includes(search))),
    )
    .sort(
      (a, b) =>
        b.date_jst.localeCompare(a.date_jst) ||
        a.sentence_id.localeCompare(b.sentence_id),
    );
  if (!records.length)
    return empty(
      state.records.length
        ? "条件に合う表現がありません"
        : "登録データはありません",
      state.records.length
        ? "検索語やカテゴリを変えてみてください。"
        : "最初の日記やフレーズを追加しましょう。",
    );
  let rows = records;
  if (ui.list.group === "entry") {
    const groups = new Map();
    for (const r of records)
      groups.set(r.entry_id, [...(groups.get(r.entry_id) ?? []), r]);
    rows = [...groups.values()];
  }
  const size = ui.list.group === "entry" ? 10 : 30;
  const pages = Math.ceil(rows.length / size);
  ui.list.page = Math.min(ui.list.page, pages - 1);
  const slice = rows.slice(ui.list.page * size, (ui.list.page + 1) * size);
  return `<p class="result-count">${records.length}件の表現${ui.list.group === "entry" ? ` · ${rows.length}のまとまり` : ""} <span>${ui.list.page + 1} / ${pages}ページ</span></p>${slice
    .map((row) =>
      Array.isArray(row)
        ? `<section class="entry-group"><h2>${escape(row[0].date_jst)} <span class="fine">${row.length}文 · ${escape(row[0].entry_id)}</span></h2>${sortDiarySentences(
            row,
          )
            .map((r) => recordCard(r, state))
            .join("")}</section>`
        : recordCard(row, state),
    )
    .join(
      "",
    )}<div class="pagination"><button class="button secondary small" data-action="prev-page"${ui.list.page === 0 ? " disabled" : ""}>前のページ</button><span>${ui.list.page + 1} / ${pages}</span><button class="button secondary small" data-action="next-page"${ui.list.page >= pages - 1 ? " disabled" : ""}>次のページ</button></div>`;
}

function manualForm(state, ui) {
  const record = ui.editId
    ? (ui.editDraft ?? state.records.find((r) => r.sentence_id === ui.editId))
    : ui.manualDraft;
  const r = record ?? {
    category: "daily",
    date_jst: jstDate(),
    entry_type: "phrase",
  };
  return `<form id="manual-form" class="form-grid"><label class="full">日本語 <span class="required">必須</span><textarea name="study_japanese" rows="3" required maxlength="30000">${escape(r.study_japanese)}</textarea></label><label class="full">英語 <span class="required">必須</span><textarea name="english" rows="3" lang="en" required maxlength="30000">${escape(r.english)}</textarea></label><label class="full">カタカナ発音<textarea name="katakana" rows="2" maxlength="30000" placeholder="ChatGPTで作った発音表記を、そのまま保存">${escape(r.katakana)}</textarea></label><label class="full">解説・補足<textarea name="explanation" rows="3" maxlength="30000">${escape(r.explanation)}</textarea></label><label class="full">別の自然な英訳（1行に1つ）<textarea name="alternative_english" rows="2" lang="en">${escape(Array.isArray(r.alternative_english) ? r.alternative_english.join("\n") : r.alternative_english)}</textarea></label><label>カテゴリ<select name="category">${categoryOptions(state, r.category, false)}</select></label><label>作成日（日本時間）<input type="date" name="date_jst" required value="${escape(r.date_jst)}"></label><label class="full">タグ（カンマ区切り）<input name="tags" value="${escape(Array.isArray(r.tags) ? r.tags.join(", ") : r.tags)}" placeholder="旅行, 仕事"></label>${
    ui.editId
      ? `<p class="fine full">元のentry_type「${escape(r.entry_type)}」とID、学習履歴・追加フィールドは維持します。</p>`
      : `<label class="full">データの種類<select name="entry_type">${options(
          [
            ["phrase", "単発フレーズ"],
            ["diary", "日記"],
            ["example", "練習例文"],
            ["addition", "補足表現"],
          ],
          r.entry_type,
        )}</select></label>`
  }<div class="actions full"><button type="submit" class="button">${ui.editId ? "変更を保存" : "追加内容を確認"}</button>${ui.editId ? '<button type="button" class="button secondary" data-action="cancel-edit">キャンセル</button>' : ""}</div></form>`;
}

function importPreview(plan) {
  const changes = plan.filter((p) => p.action === "update");
  const others = plan.filter((p) => p.action !== "update");
  const visible = [...changes, ...others.slice(0, 200)];
  const count = (action) => plan.filter((p) => p.action === action).length;
  return `<section class="panel import-preview" id="import-preview" tabindex="-1"><p class="eyebrow">IMPORT PREVIEW</p><h2>登録内容の確認</h2><div class="metrics">${metric(count("new"), "新規追加")}${metric(count("duplicate"), "重複・追加しない")}${metric(count("update"), "更新候補")}</div>${count("update") ? '<p class="warning-text">更新は、下の候補にチェックしたものだけ行います。学習履歴は維持します。</p>' : ""}<div class="preview-items">${visible.map((p) => `<div class="preview-item">${p.action === "update" ? `<label class="update-choice"><input type="checkbox" name="update-record" value="${escape(p.record.sentence_id)}">この内容に更新する</label>` : `<span class="badge ${p.action === "duplicate" ? "pale" : ""}">${p.action === "new" ? "新規追加" : "重複"}</span>`}<p>${escape(p.record.study_japanese)}</p><p lang="en">${escape(p.record.english)}</p><small>${escape(p.record.date_jst)} · ${escape(categoryName(p.record.category))}</small>${p.action === "update" ? `<details><summary>現在の内容と変更後を比較</summary><h3>現在</h3><pre>${escape(JSON.stringify(p.before, null, 2))}</pre><h3>変更後</h3><pre>${escape(JSON.stringify(p.record, null, 2))}</pre></details>` : ""}</div>`).join("")}${others.length > 200 ? `<p class="fine">更新候補はすべて、新規・重複は先頭200件を表示しています。表示外の新規・重複${others.length - 200}件も集計どおりに処理します。</p>` : ""}</div><button class="button" data-action="commit-import">追加してバックアップ</button><p class="fine">保存後、全データのJSONをダウンロードします。既存の学習履歴は維持します。</p></section>`;
}

export function add(state, ui) {
  if (ui.editId)
    return (
      heading(
        "EDIT",
        "表現を編集",
        "変更しても、この表現の学習履歴は維持します。",
      ) + `<section class="panel">${manualForm(state, ui)}</section>`
    );
  return (
    heading(
      "ADD",
      "新しい表現を追加",
      "JSONファイル・貼り付け・手入力で登録できます。",
    ) +
    `<div class="tabs" role="group" aria-label="追加方法"><button class="${ui.addMode === "json" ? "active" : ""}" data-action="add-json">JSON・ファイル</button><button class="${ui.addMode === "manual" ? "active" : ""}" data-action="add-manual">手入力</button></div><section class="panel">${ui.addMode === "manual" ? manualForm(state, ui) : `<form id="import-form"><label class="file-picker">JSONファイルを選ぶ<input id="import-file" type="file" accept=".json,application/json,text/plain"><span class="fine">初期の diary_pairs.json もこちらから（10MBまで）</span></label><div class="divider"><span>または、ChatGPTから貼り付け</span></div><label>追加用JSON<textarea id="import-json" rows="10" spellcheck="false" placeholder='[{"study_japanese": "架空の日本語", "english": "A fictional sentence.", "category": "daily"}]'>${escape(ui.importInput)}</textarea></label><button type="submit" class="button">追加内容を確認</button><details class="help"><summary>ChatGPTには、どう頼む？</summary><p>「アプリ追加用JSONで出して。study_japanese、english、date_jst、entry_type、category、katakana、explanation、alternative_englishを含めて」と依頼します。</p><p>1件のオブジェクト・複数件の配列に対応。IDは省略できます。発音表記はアプリでは生成しません。</p></details></form>`}</section>${ui.importPlan ? importPreview(ui.importPlan) : ""}`
  );
}

export function stats(state) {
  const s = summarize(state.records, state.progress);
  const weak = state.records.filter((r) => isWeak(pFor(state, r.sentence_id)));
  return (
    heading("PROGRESS", "学習の記録", "自己採点と音読回数を集計します。") +
    `<section class="metrics six">${metric(s.total, "総問題数")}${metric(s.studied, "学習済み")}${metric(s.unseen, "未学習")}${metric(s.accuracy === null ? "—" : `${s.accuracy}%`, "累計正解率（自己採点）")}${metric(s.weak, "苦手な問題")}${metric(s.readAloud, "累計音読回数")}</section><section class="panel"><h2>カテゴリ別の学習状況</h2><div class="table-scroll"><table><thead><tr><th scope="col">カテゴリ</th><th scope="col">問題数</th><th scope="col">学習済み</th><th scope="col">正解率</th><th scope="col">音読</th></tr></thead><tbody>${categories(
      state,
    )
      .map(([key, name]) => {
        const c = summarize(
          state.records.filter((r) => r.category === key),
          state.progress,
        );
        return `<tr><th scope="row">${escape(name)}</th><td>${c.total}</td><td>${c.studied}</td><td>${c.accuracy === null ? "—" : `${c.accuracy}%`}</td><td>${c.readAloud}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div><p class="fine">正解 ${s.correct}回・もう一度 ${s.incorrect}回。正解率は自己採点の累計です。</p></section><section class="panel"><h2>もう少し練習したい表現</h2><p class="fine">前回「もう一度」、または不正解回数が正解回数を上回る表現です。</p>${
      weak.length
        ? weak
            .slice(0, 10)
            .map(
              (r) =>
                `<div class="weak-row"><p>${escape(r.study_japanese)}</p><button class="button secondary small" data-action="study-one" data-id="${escape(r.sentence_id)}">復習する</button></div>`,
            )
            .join("")
        : '<p class="muted">苦手な表現はまだありません。</p>'
    }</section>`
  );
}

export function settings(state, ui) {
  const dirty = state.revision > (state.last_backup?.revision ?? 0);
  const b = ui.restore;
  const conflicts = b
    ? b.records.filter((r) => {
        const old = state.records.find((o) => o.sentence_id === r.sentence_id);
        return old && !same(old, r);
      })
    : [];
  const rates = [
    [0.5, "0.5倍 · ゆっくり"],
    [0.7, "0.7倍"],
    [0.85, "0.85倍 · おすすめ"],
    [1, "1.0倍"],
    [1.2, "1.2倍"],
    [1.5, "1.5倍"],
  ];
  if (!rates.some(([value]) => value === state.settings.speechRate))
    rates.push([state.settings.speechRate, `${state.settings.speechRate}倍`]);
  return (
    heading(
      "SETTINGS",
      "設定・バックアップ",
      "データのバックアップ・復元と学習設定。",
    ) +
    `<section class="panel"><div class="section-title"><h2>データをバックアップ</h2><span class="badge ${dirty ? "amber" : ""}">${dirty ? "未バックアップの更新あり" : "更新なし"}</span></div><p>全${state.records.length}件の表現・学習履歴・音読回数・設定を、1つのJSONにまとめます。</p><dl class="info-list"><div><dt>最終バックアップ作成</dt><dd>${escape(displayTime(state.last_backup?.created_at))}</dd></div><div><dt>データ最終更新</dt><dd>${escape(displayTime(state.updated_at))}</dd></div></dl><button class="button" data-action="backup">全データをバックアップ</button>${ui.lastDownload ? '<button class="button secondary" data-action="retry-download">直前のバックアップを再ダウンロード</button>' : ""}<p class="warning-text">バックアップには日記などの個人情報が含まれます。安全な場所に保存してください。</p><p class="fine">ブラウザから端末への保存完了は確認できません。ダウンロード一覧でファイルの保存を確認してください。</p></section>
  <section class="panel"><h2>バックアップから復元</h2><p class="muted">日記・フレーズ・学習履歴・設定をJSONから復元します。</p><form id="restore-form"><label class="file-picker">バックアップJSONを選ぶ<input id="restore-file" type="file" accept=".json,application/json,text/plain"><span class="fine">10MBまで · 初期データの配列は「追加」画面へ</span></label><details${ui.restoreInput ? " open" : ""}><summary>JSONテキストから復元する</summary><label>バックアップJSON<textarea id="restore-json" rows="6" spellcheck="false">${escape(ui.restoreInput)}</textarea></label></details><button type="submit" class="button secondary">復元内容を確認</button></form>${
    b
      ? `<div id="restore-preview" class="restore-preview" tabindex="-1"><h3>復元前の確認</h3><p>${b.records.length}件の表現、${b.progress.length}件の学習履歴</p><p class="fine">作成：${escape(displayTime(b.created_at))} · 内容の競合 ${conflicts.length}件</p>${
          conflicts.length
            ? `<details><summary>競合する表現を確認（先頭20件）</summary>${conflicts
                .slice(0, 20)
                .map(
                  (r) =>
                    `<div class="preview-item"><p>${escape(r.sentence_id)}</p><p>端末：${escape(state.records.find((o) => o.sentence_id === r.sentence_id).english)}</p><p>バックアップ：${escape(r.english)}</p></div>`,
                )
                .join("")}</details>`
            : ""
        }<label>統合時に内容が競合したら<select id="merge-policy"><option value="local">端末の内容を維持する</option><option value="backup">バックアップの内容を採用する</option></select></label><label class="checkbox-label"><input id="merge-settings" type="checkbox">統合時にバックアップの学習設定も採用する</label><p class="fine">学習履歴は更新日時が新しい側を1件ずつ採用し、回数は加算しません。同時刻で異なる場合は上の選択を適用します。異なる端末の回数を合計する方式ではありません。</p><div class="actions"><button class="button" data-action="restore-merge">既存データと統合</button><button class="button secondary" data-action="restore-overwrite">既存データを上書き</button><button class="button secondary" data-action="restore-cancel">キャンセル</button></div></div>`
      : ""
  }</section>
  <section class="panel"><h2>読み上げと保存の設定</h2><label>英文の読み上げ速度<select id="speech-rate">${options(
    rates.sort((a, b) => a[0] - b[0]),
    state.settings.speechRate,
  )}</select></label><p class="fine">端末内の英語音声だけを使います。利用できない場合はChrome・端末の音声設定を確認してください。カタカナ表記とは独立した機能です。</p><hr><h3>端末の保存領域</h3><p id="storage-info" class="muted">${escape(ui.storageInfo ?? "保存領域の状態を確認中…")}</p><button class="button secondary" data-action="persist-storage">永続ストレージを要求</button><p class="fine">許可されても、ブラウザのデータ削除や端末の故障は防げません。シークレットモードでの利用は避け、必ずバックアップしてください。</p></section>
  <section class="panel soft"><h2>ホーム画面に追加</h2><p>Android Chromeのメニューから「ホーム画面に追加」または「アプリをインストール」を選べます。</p>${ui.installPrompt ? '<button class="button secondary" data-action="install-app">ホーム画面に追加する</button>' : ""}<p class="fine">初回の読み込み後はオフラインでも利用できます。データはブラウザ・端末ごとに保存され、自動同期はしません。音声は端末内の対応音声が必要です。</p><p class="fine">PLAY BACK v1.2.0 · 表示日時は日本時間（JST）</p></section>`
  );
}

export function render(view, state, ui) {
  return { home, study, library, add, stats, settings }[view](state, ui);
}
