import { CATEGORIES, DEFAULT_SETTINGS } from "./core.js";

const NAME = "english-diary-review";
let connection;

export function openDB() {
  if (connection) return Promise.resolve(connection);
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        new Error(
          "このブラウザではIndexedDBを利用できません。通常モードのChromeでお試しください。",
        ),
      );
    const request = indexedDB.open(NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("records", { keyPath: "sentence_id" });
      db.createObjectStore("progress", { keyPath: "sentence_id" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "別のタブがデータベースを使用しています。他のタブを閉じて再読み込みしてください。",
        ),
      );
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      connection = db;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  });
}

function snapshot(records, progress, rows) {
  const meta = new Map(rows.map((r) => [r.key, r.value]));
  return {
    records,
    progress,
    settings: meta.get("settings") ?? structuredClone(DEFAULT_SETTINGS),
    categories: meta.get("categories") ?? Object.keys(CATEGORIES),
    revision: meta.get("revision") ?? 0,
    updated_at: meta.get("updated_at") ?? null,
    last_backup: meta.get("last_backup") ?? null,
  };
}

export async function readSnapshot() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["records", "progress", "meta"], "readonly");
    const records = tx.objectStore("records").getAll();
    const progress = tx.objectStore("progress").getAll();
    const meta = tx.objectStore("meta").getAll();
    tx.oncomplete = () =>
      resolve(snapshot(records.result, progress.result, meta.result));
    tx.onabort = () =>
      reject(tx.error ?? new Error("データの読み込みに失敗しました。"));
    tx.onerror = () => {};
  });
}

export async function commit(next, expectedRevision) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["records", "progress", "meta"], "readwrite");
    let result;
    let cause;
    const meta = tx.objectStore("meta");
    const request = meta.get("revision");
    request.onsuccess = () => {
      try {
        if ((request.result?.value ?? 0) !== expectedRevision)
          throw new Error(
            "別のタブで更新されました。最新データを読み直しましたので、内容を確認して再操作してください。",
          );
        result = {
          ...next,
          revision: expectedRevision + 1,
          updated_at: new Date().toISOString(),
        };
        const records = tx.objectStore("records");
        const progress = tx.objectStore("progress");
        records.clear();
        progress.clear();
        for (const row of result.records) records.put(row);
        for (const row of result.progress) progress.put(row);
        for (const key of ["settings", "categories", "revision", "updated_at"])
          meta.put({ key, value: result[key] });
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(cause ?? tx.error ?? new Error("保存を完了できませんでした。"));
    tx.onerror = () => {};
  });
}

export async function markBackup(revision, created_at) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    let cause;
    const store = tx.objectStore("meta");
    const request = store.get("last_backup");
    request.onsuccess = () => {
      try {
        if ((request.result?.value?.revision ?? -1) <= revision)
          store.put({ key: "last_backup", value: { revision, created_at } });
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(
        cause ??
          tx.error ??
          new Error("バックアップ作成日時を記録できませんでした。"),
      );
    tx.onerror = () => {};
  });
}
