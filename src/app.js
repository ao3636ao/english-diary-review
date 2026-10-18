import {
  MAX_FILE_SIZE,
  DEFAULT_FILTERS,
  parseJSON,
  planImport,
  applyImport,
  normalizeRecord,
  emptyProgress,
  gradeReview,
  readReview,
  setReadCount,
  selectReviewItems,
  makeBackup,
  validateBackup,
  mergeBackup,
  backupFilename,
  validateSettings,
} from "./core.js";
import { readSnapshot, commit, markBackup } from "./db.js";
import { render, libraryResults, escape, displayTime } from "./views.js";

const main = document.querySelector("#main");
const ui = {
  session: null,
  studyConfigOpen: true,
  answer: false,
  mode: "custom",
  list: { query: "", category: "all", group: "sentence", page: 0 },
  addMode: "json",
  importInput: "",
  importPlan: null,
  importRevision: null,
  manualDraft: null,
  editDraft: null,
  editId: null,
  restore: null,
  restoreInput: "",
  restoreRevision: null,
  lastDownload: null,
  installPrompt: null,
  storageInfo: "",
};
let state;
let view = "home";
let busy = false;
let waitingWorker;
let updateRequested = false;
const channel =
  "BroadcastChannel" in window
    ? new BroadcastChannel("english-diary-review-updates")
    : null;

function errorMessage(error) {
  if (error?.name === "QuotaExceededError")
    return "端末の保存容量が不足しています。保存できませんでした。現在のデータをバックアップし、空き容量を確保してください。";
  return error?.message || "操作を完了できませんでした。再度お試しください。";
}

function notify(message, error = false, retry = false) {
  const notice = document.querySelector("#notice");
  notice.replaceChildren();
  const close = document.createElement("button");
  close.type = "button";
  close.className = "notice-dismiss";
  close.dataset.action = "dismiss";
  close.setAttribute("aria-label", "通知を閉じる");
  close.textContent = "×";
  const text = document.createElement("span");
  text.textContent = message;
  notice.append(close, text);
  if (retry) {
    notice.append(document.createElement("br"));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button small";
    button.dataset.action = "retry-download";
    button.textContent = "バックアップを再ダウンロード";
    notice.append(button);
  }
  notice.classList.toggle("error", error);
  notice.setAttribute("role", error ? "alert" : "status");
  notice.hidden = false;
}

function renderShell() {
  const dirty = state.revision > (state.last_backup?.revision ?? 0);
  const status = document.querySelector("#backup-status");
  status.classList.toggle("dirty", dirty);
  status.innerHTML = dirty
    ? '<button type="button" data-action="backup">未バックアップの更新があります。ノートをバックアップ →</button>'
    : state.last_backup
      ? `最終バックアップ作成：${escape(displayTime(state.last_backup.created_at))}（端末への保存を確認してください）`
      : "データはこの端末のブラウザ内に保存されます。";
  document.querySelector("#connection").textContent = navigator.onLine
    ? "端末内に保存"
    : "オフライン";
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function renderPage(focus = false) {
  if (!state) return;
  main.innerHTML = render(view, state, ui);
  renderShell();
  if (focus) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
}

function go(next) {
  if (location.hash === `#${next}`) {
    view = next;
    renderPage(true);
  } else location.hash = next;
}

function currentRecord(id) {
  const record = state.records.find((r) => r.sentence_id === id);
  if (!record)
    throw new Error("表現が見つかりません。最新の一覧を確認してください。");
  return record;
}

async function save(next) {
  // Keep every export within the same limit accepted by the restore UI.
  if (
    new Blob([
      JSON.stringify(
        makeBackup({ ...next, updated_at: new Date().toISOString() }),
        null,
        2,
      ),
    ]).size > MAX_FILE_SIZE
  )
    throw new Error(
      "バックアップ可能な総データ量（10MB）を超えます。追加内容を減らしてください。",
    );
  state = await commit(next, state.revision);
  channel?.postMessage({ revision: state.revision });
  renderShell();
}

async function run(task) {
  if (busy || !state) return;
  busy = true;
  document.body.classList.add("busy");
  main.setAttribute("aria-busy", "true");
  try {
    await task();
  } catch (error) {
    try {
      state = await readSnapshot();
      renderShell();
      if (error?.message?.startsWith("別のタブで更新")) {
        ui.importPlan = null;
        ui.restore = null;
        ui.editDraft = null;
        renderPage();
      }
    } catch {
      /* keep the original failure */
    }
    notify(errorMessage(error), true);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    main.removeAttribute("aria-busy");
  }
}

async function confirmAction(title, message, label) {
  const dialog = document.querySelector("#confirm-dialog");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-yes").textContent = label;
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    );
    dialog.showModal();
  });
}

function downloadFile(download) {
  const blob = new Blob([download.json], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function exportBackup({ saved = false, retry = false } = {}) {
  try {
    if (!retry) {
      ui.lastDownload = null;
      state = await readSnapshot();
      const backup = makeBackup(state);
      validateBackup(backup);
      ui.lastDownload = {
        json: JSON.stringify(backup, null, 2),
        filename: backupFilename(),
        created_at: backup.created_at,
        revision: state.revision,
        count: backup.records.length,
      };
    }
    if (!ui.lastDownload)
      throw new Error("ダウンロードするバックアップがありません。");
    downloadFile(ui.lastDownload);
    await markBackup(ui.lastDownload.revision, ui.lastDownload.created_at);
    state = await readSnapshot();
    renderShell();
    if (view === "settings") renderPage();
    notify(
      `${saved ? "追加・更新データを保存しました。\n" : ""}${ui.lastDownload.count}件を含むバックアップのダウンロードを要求しました。端末への保存完了は確認できません。Chromeのダウンロード一覧を確認してください。`,
      false,
      true,
    );
  } catch (error) {
    notify(
      `${saved ? "追加・更新データは端末内に保存済みです。\n" : ""}バックアップの作成・ダウンロードを完了できませんでした。${errorMessage(error)}${ui.lastDownload ? "\n下のボタンから再試行できます。" : ""}`,
      true,
      Boolean(ui.lastDownload),
    );
    if (view === "settings") renderPage();
  }
}

async function fileText(file) {
  if (!file) return null;
  if (file.size > MAX_FILE_SIZE)
    throw new Error("ファイルは10MB以内にしてください。");
  return file.text();
}

async function prepareImport(input) {
  state = await readSnapshot();
  ui.importPlan = null;
  ui.importPlan = planImport(input, state.records);
  ui.importRevision = state.revision;
  renderPage();
  document.querySelector("#import-preview")?.focus();
}

function setProgress(progress) {
  return {
    ...state,
    progress: [
      ...state.progress.filter((p) => p.sentence_id !== progress.sentence_id),
      progress,
    ],
  };
}

function startSession(items) {
  if (!items.length) {
    ui.session = null;
    ui.answer = false;
    ui.studyConfigOpen = true;
    notify(
      "この条件に合う問題がありません。出題条件を変えるか、表現を追加してください。",
    );
    go("study");
    return;
  }
  ui.session = {
    items,
    index: 0,
    remembered: 0,
    again: 0,
    grades: new Map(),
    tools: new Set(),
  };
  ui.studyConfigOpen = false;
  ui.answer = false;
  go("study");
}

function currentReview() {
  const item = ui.session?.items[ui.session.index];
  if (!item)
    throw new Error("復習する問題がありません。復習をはじめ直してください。");
  item.ids.forEach(currentRecord);
  return item;
}

async function gradeCurrent(result) {
  const session = ui.session;
  if (!session || !ui.answer || session.index >= session.items.length) return;
  const { ids } = currentReview();
  const outcomes = ids.map((id) => session.grades.get(id) ?? result);
  await save({
    ...state,
    progress: gradeReview(state.progress, ids, result, session.grades),
  });
  for (const outcome of outcomes)
    session[outcome === "remembered" ? "remembered" : "again"]++;
  session.index++;
  session.grades.clear();
  session.tools.clear();
  ui.answer = false;
  renderPage();
  main.focus({ preventScroll: true });
  document
    .querySelector(".study-card, .session-finished")
    ?.scrollIntoView({ block: "start" });
}

async function changeReadCount(id, value) {
  currentRecord(id);
  const progress =
    state.progress.find((p) => p.sentence_id === id) ?? emptyProgress(id);
  await save(setProgress(setReadCount(progress, value)));
  renderPage();
  notify(`音読回数を${value}回に保存しました。`);
}

function speakText(text) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window))
    throw new Error("このブラウザは音声読み上げに対応していません。");
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.localService === true && /^en(?:[-_]|$)/i.test(v.lang));
  if (!voices.length)
    throw new Error(
      "端末内で利用できる英語音声がありません。Androidの音声読み上げ設定で英語のオフライン音声を追加してください。外部への送信を避けるため、オンライン音声では読み上げません。",
    );
  speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.voice = voices.find((v) => /^en[-_]US$/i.test(v.lang)) ?? voices[0];
  speech.lang = speech.voice.lang;
  speech.rate = state.settings.speechRate;
  speech.onerror = () =>
    notify(
      "読み上げを完了できませんでした。端末の英語音声設定を確認してください。",
      true,
    );
  speechSynthesis.speak(speech);
}

async function restore(mode) {
  if (!ui.restore) return;
  if (ui.restoreRevision !== state.revision)
    throw new Error(
      "プレビュー後に端末データが更新されました。復元内容をもう一度確認してください。",
    );
  const backup = validateBackup(ui.restore);
  let next;
  if (mode === "overwrite") {
    const confirmed = await confirmAction(
      "端末の全データを上書きしますか？",
      `現在の${state.records.length}件と学習履歴・設定を、バックアップの${backup.records.length}件に置き換えます。\n必要なデータは先にバックアップしてください。この操作は取り消せません。`,
      "全データを上書き",
    );
    if (!confirmed) return;
    next = {
      ...state,
      records: backup.records,
      progress: backup.progress,
      categories: backup.categories,
      settings: backup.settings,
    };
  } else {
    const preferBackup =
      document.querySelector("#merge-policy").value === "backup";
    const restoreSettings = document.querySelector("#merge-settings").checked;
    if (
      !(await confirmAction(
        "バックアップと統合しますか？",
        `既存のデータを残して統合します。内容の競合は${preferBackup ? "バックアップ" : "端末"}を優先します。\n学習履歴は新しい側を採用し、回数は二重加算しません。`,
        "統合する",
      ))
    )
      return;
    next = mergeBackup(state, backup, { preferBackup, restoreSettings });
  }
  await save(next);
  ui.restore = null;
  ui.restoreInput = "";
  ui.session = null;
  ui.importPlan = null;
  renderPage();
  notify(
    `${state.records.length}件の表現と学習履歴・設定を${mode === "overwrite" ? "復元" : "統合"}しました。復元後のデータもバックアップしてください。`,
  );
}

const actions = {
  dismiss: () => {
    document.querySelector("#notice").hidden = true;
  },
  backup: () => exportBackup(),
  "retry-download": () => exportBackup({ retry: true }),
  "start-study": () =>
    startSession(
      selectReviewItems(state.records, state.progress, state.settings.filters),
    ),
  "start-diary-study": async () => {
    const filters = { ...DEFAULT_FILTERS, unit: "diary-set" };
    await save({
      ...state,
      settings: validateSettings({ ...state.settings, filters }),
    });
    ui.mode = "diary-set";
    startSession(selectReviewItems(state.records, state.progress, filters));
  },
  "study-one": (button) => {
    const r = currentRecord(button.dataset.id);
    startSession([
      { type: "sentence", entry_id: r.entry_id, ids: [r.sentence_id] },
    ]);
  },
  "study-entry": (button) => {
    const r = currentRecord(button.dataset.id);
    const item = selectReviewItems(state.records, state.progress, {
      ...DEFAULT_FILTERS,
      unit: "diary-set",
    }).find((item) => item.entry_id === r.entry_id);
    startSession(item ? [item] : []);
  },
  reveal: () => {
    ui.answer = true;
    renderPage();
    document.querySelector("#answer")?.scrollIntoView({ block: "start" });
  },
  speak: (button) => speakText(currentRecord(button.dataset.id).english),
  "speak-set": () =>
    speakText(
      currentReview()
        .ids.map((id) => currentRecord(id).english)
        .join("\n"),
    ),
  "grade-remembered": () => gradeCurrent("remembered"),
  "grade-again": () => gradeCurrent("again"),
  "add-read": (button) => {
    const p =
      state.progress.find((p) => p.sentence_id === button.dataset.id) ??
      emptyProgress(button.dataset.id);
    return changeReadCount(button.dataset.id, p.read_aloud_count + 1);
  },
  "set-read": (button) =>
    changeReadCount(
      button.dataset.id,
      Number(
        document.getElementById(button.dataset.readInput || "read-count").value,
      ),
    ),
  "add-read-set": async () => {
    const { ids } = currentReview();
    await save({ ...state, progress: readReview(state.progress, ids) });
    renderPage();
    notify(`日記の${ids.length}文それぞれに音読1回を保存しました。`);
  },
  "prev-page": () => {
    ui.list.page = Math.max(0, ui.list.page - 1);
    updateList();
  },
  "next-page": () => {
    ui.list.page++;
    updateList();
  },
  "add-json": () => {
    ui.addMode = "json";
    ui.importPlan = null;
    renderPage();
  },
  "add-manual": () => {
    ui.addMode = "manual";
    ui.importPlan = null;
    renderPage();
  },
  "commit-import": async () => {
    if (!ui.importPlan) return;
    if (ui.importRevision !== state.revision)
      throw new Error(
        "プレビュー後にデータが変わりました。追加内容をもう一度確認してください。",
      );
    const updates = new Set(
      [...document.querySelectorAll('input[name="update-record"]:checked')].map(
        (e) => e.value,
      ),
    );
    const added = ui.importPlan.filter((p) => p.action === "new").length;
    if (added || updates.size)
      await save(applyImport(state, ui.importPlan, updates));
    ui.importPlan = null;
    ui.importInput = "";
    ui.manualDraft = null;
    renderPage();
    await exportBackup({ saved: Boolean(added || updates.size) });
  },
  edit: (button) => {
    currentRecord(button.dataset.id);
    ui.editId = button.dataset.id;
    ui.editDraft = structuredClone(currentRecord(button.dataset.id));
    ui.importPlan = null;
    go("add");
  },
  "cancel-edit": () => {
    ui.editId = null;
    ui.editDraft = null;
    go("library");
  },
  delete: async (button) => {
    const r = currentRecord(button.dataset.id);
    if (
      !(await confirmAction(
        "この表現を削除しますか？",
        `${r.study_japanese}\n\n学習履歴も削除します。元に戻すにはバックアップが必要です。必要ならキャンセルして、先にバックアップしてください。`,
        "表現と履歴を削除",
      ))
    )
      return;
    await save({
      ...state,
      records: state.records.filter((row) => row.sentence_id !== r.sentence_id),
      progress: state.progress.filter((p) => p.sentence_id !== r.sentence_id),
    });
    ui.importPlan = null;
    renderPage();
    notify("表現と学習履歴を削除しました。");
  },
  "restore-merge": () => restore("merge"),
  "restore-overwrite": () => restore("overwrite"),
  "restore-cancel": () => {
    ui.restore = null;
    ui.restoreInput = "";
    renderPage();
  },
  "persist-storage": async () => {
    if (!navigator.storage?.persist) {
      notify(
        "このブラウザでは永続ストレージを要求できません。定期的にバックアップしてください。",
      );
      return;
    }
    const granted = await navigator.storage.persist();
    await storageInfo();
    renderPage();
    notify(
      granted
        ? "永続ストレージが許可されました。バックアップは引き続き必要です。"
        : "永続ストレージは許可されませんでした。通常の保存は利用できます。バックアップを続けてください。",
    );
  },
  "install-app": async () => {
    if (!ui.installPrompt) return;
    await ui.installPrompt.prompt();
    await ui.installPrompt.userChoice;
    ui.installPrompt = null;
    renderPage();
  },
  "update-app": async () => {
    if (!waitingWorker) return;
    if (
      !(await confirmAction(
        "アプリを更新しますか？",
        "更新のため再読み込みします。入力中で未登録のJSONやフォームは失われます。保存済みのデータは維持されます。",
        "更新して再読み込み",
      ))
    )
      return;
    updateRequested = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  },
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !Object.hasOwn(actions, button.dataset.action)) return;
  event.preventDefault();
  if (button.dataset.action === "dismiss") {
    actions.dismiss();
    return;
  }
  void run(() => actions[button.dataset.action](button));
});

function updateList() {
  const target = document.querySelector("#library-results");
  if (target) target.innerHTML = libraryResults(state, ui);
}

document.addEventListener("input", (event) => {
  const e = event.target;
  if (e.id === "import-json") {
    ui.importInput = e.value;
    invalidateImportPreview();
  }
  if (e.id === "restore-json") {
    ui.restoreInput = e.value;
    ui.restore = null;
    document.querySelector("#restore-preview")?.remove();
  }
  if (e.id === "list-search") {
    ui.list.query = e.value;
    ui.list.page = 0;
    updateList();
  }
  if (e.closest("#manual-form")) {
    const fields = manualData(e.closest("form"));
    if (ui.editId) ui.editDraft = { ...currentRecord(ui.editId), ...fields };
    else ui.manualDraft = fields;
    invalidateImportPreview();
  }
});

function invalidateImportPreview() {
  ui.importPlan = null;
  document.querySelector("#import-preview")?.remove();
}

function manualData(form) {
  const fields = Object.fromEntries(new FormData(form));
  fields.alternative_english = fields.alternative_english
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return fields;
}

document.addEventListener("submit", (event) => {
  if (!["manual-form", "import-form", "restore-form"].includes(event.target.id))
    return;
  event.preventDefault();
  const form = event.target;
  void run(async () => {
    if (form.id === "import-form") {
      ui.importInput = document.querySelector("#import-json").value;
      await prepareImport(parseJSON(ui.importInput));
    }
    if (form.id === "manual-form") {
      const fields = manualData(form);
      if (ui.editId) {
        const before = currentRecord(ui.editId);
        const record = normalizeRecord({ ...before, ...fields });
        await save({
          ...state,
          records: state.records.map((r) =>
            r.sentence_id === ui.editId ? record : r,
          ),
        });
        ui.editId = null;
        ui.editDraft = null;
        ui.manualDraft = null;
        go("library");
        notify("変更を保存しました。学習履歴は維持されています。");
      } else {
        ui.manualDraft = fields;
        await prepareImport(fields);
      }
    }
    if (form.id === "restore-form") {
      ui.restoreInput = document.querySelector("#restore-json").value;
      ui.restore = null;
      const backup = validateBackup(parseJSON(ui.restoreInput));
      state = await readSnapshot();
      ui.restore = backup;
      ui.restoreRevision = state.revision;
      renderPage();
      document.querySelector("#restore-preview")?.focus();
    }
  });
});

main.addEventListener(
  "toggle",
  (event) => {
    const target = event.target;
    if (!target.isConnected) return;
    if (target.matches("details.study-config"))
      ui.studyConfigOpen = target.open;
    if (target.matches("details.sentence-tools") && ui.session) {
      if (target.open) ui.session.tools.add(target.dataset.sentenceTools);
      else ui.session.tools.delete(target.dataset.sentenceTools);
    }
  },
  true,
);

document.addEventListener("change", (event) => {
  const e = event.target;
  if (e.dataset.sentenceGrade !== undefined && ui.session) {
    const id = e.dataset.sentenceGrade;
    if (currentReview().ids.includes(id)) {
      if (e.value === "remembered" || e.value === "again")
        ui.session.grades.set(id, e.value);
      else ui.session.grades.delete(id);
    }
  }
  if (["import-file", "restore-file"].includes(e.id)) {
    void run(async () => {
      const source = await fileText(e.files[0]);
      if (source === null) return;
      if (e.id === "import-file") {
        ui.importInput = source;
        invalidateImportPreview();
        document.querySelector("#import-json").value = source;
        await prepareImport(parseJSON(source));
      } else {
        ui.restoreInput = source;
        ui.restore = null;
        document.querySelector("#restore-preview")?.remove();
        document.querySelector("#restore-json").value = source;
        const backup = validateBackup(parseJSON(source));
        state = await readSnapshot();
        ui.restore = backup;
        ui.restoreRevision = state.revision;
        renderPage();
        document.querySelector("#restore-preview")?.focus();
      }
    });
  }
  if (e.id === "list-category" || e.id === "list-group") {
    ui.list[e.id === "list-category" ? "category" : "group"] = e.value;
    ui.list.page = 0;
    updateList();
  }
  if (e.id.startsWith("study-")) {
    void run(async () => {
      let filters = { ...state.settings.filters };
      if (e.id === "study-mode") {
        ui.mode = e.value;
        if (e.value !== "custom") {
          filters = { ...DEFAULT_FILTERS, unit: filters.unit ?? "auto" };
          if (e.value === "diary-set") filters.unit = "diary-set";
          if (["diary", "daily", "business", "practice"].includes(e.value))
            filters.category = e.value;
          if (["unseen", "wrong"].includes(e.value)) filters.status = e.value;
          if (e.value === "weak") filters.order = "weak";
          if (e.value === "date") filters.order = "date";
          if (e.value === "period") {
            filters.from = state.settings.filters.from;
            filters.to = state.settings.filters.to;
            filters.order = "date";
          }
        }
      } else {
        filters[e.id.replace("study-", "")] = e.value;
        ui.mode = "custom";
      }
      const settings = validateSettings({ ...state.settings, filters });
      await save({ ...state, settings });
      renderPage();
    });
  }
  if (e.id === "speech-rate")
    void run(async () => {
      await save({
        ...state,
        settings: validateSettings({
          ...state.settings,
          speechRate: Number(e.value),
        }),
      });
      notify("読み上げ速度を保存しました。");
    });
});

window.addEventListener("hashchange", () => {
  const requested = location.hash.slice(1);
  view = ["home", "study", "library", "add", "stats", "settings"].includes(
    requested,
  )
    ? requested
    : "home";
  if (view !== "study" && "speechSynthesis" in window) speechSynthesis.cancel();
  renderPage(true);
});
window.addEventListener("online", () => state && renderShell());
window.addEventListener("offline", () => state && renderShell());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  ui.installPrompt = event;
  if (view === "settings") renderPage();
});
window.addEventListener("appinstalled", () => {
  ui.installPrompt = null;
  if (view === "settings") renderPage();
});

channel?.addEventListener("message", async () => {
  if (!state || busy) return;
  try {
    const fresh = await readSnapshot();
    if (fresh.revision === state.revision) return;
    state = fresh;
    ui.importPlan = null;
    ui.restore = null;
    ui.editId = null;
    ui.editDraft = null;
    ui.session = null;
    renderPage();
    notify(
      "別のタブで更新されました。最新の保存データを読み込みました。入力中の内容は確認し直してください。",
    );
  } catch (error) {
    notify(errorMessage(error), true);
  }
});

async function storageInfo() {
  try {
    const persistent = await navigator.storage?.persisted?.();
    const estimate = await navigator.storage?.estimate?.();
    ui.storageInfo = `${persistent ? "永続ストレージ：許可済み" : "永続ストレージ：未許可または非対応"}${estimate?.usage !== undefined ? ` · 使用量 約${(estimate.usage / 1024 / 1024).toFixed(1)}MB` : ""}`;
  } catch {
    ui.storageInfo =
      "保存領域の状態を取得できません。バックアップを続けてください。";
  }
}

async function setupOffline() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register(
      new URL("../sw.js", import.meta.url),
      { scope: new URL("../", import.meta.url).pathname },
    );
    const showUpdate = () => {
      waitingWorker = registration.waiting;
      if (waitingWorker)
        document.querySelector("#update-banner").hidden = false;
    };
    showUpdate();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          showUpdate();
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested) location.reload();
    });
  } catch {
    notify(
      "オフライン用ファイルを保存できませんでした。オンラインでの通常利用は可能です。",
    );
  }
}

async function init() {
  try {
    state = await readSnapshot();
    view = ["home", "study", "library", "add", "stats", "settings"].includes(
      location.hash.slice(1),
    )
      ? location.hash.slice(1)
      : "home";
    await storageInfo();
    renderPage();
    void setupOffline();
  } catch (error) {
    main.innerHTML = `<section class="panel"><h1>保存領域を開けませんでした</h1><p>${escape(errorMessage(error))}</p><p>ブラウザの通常モード・空き容量・保存の許可を確認し、再読み込みしてください。既存データの削除や初期化は行っていません。</p></section>`;
    document.querySelectorAll('[data-action="backup"]').forEach((button) => {
      button.disabled = true;
    });
  }
}
void init();
