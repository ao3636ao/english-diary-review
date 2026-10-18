// All learning content in tests is fictional. Never put real diary files here.
export function diary181() {
  return Array.from({ length: 181 }, (_, i) => ({
    sentence_id: `fiction-${i + 1}`,
    entry_id:
      i < 130 ? `fiction-entry-${Math.floor(i / 3)}` : `fiction-example-${i}`,
    date_jst: `2026-09-${String(1 + Math.floor(i / 9)).padStart(2, "0")}`,
    entry_type: i < 130 ? "diary" : i < 178 ? "example" : "addition",
    study_japanese: `架空のテスト文${i + 1}です。`,
    english: `This is fictional test sentence ${i + 1}.`,
    katakana: i < 20 ? `フィクション ${i + 1}` : "",
    japanese_provenance: "fictional_test",
    mapping_note: "実在しないテスト用データです。",
    original_source: {
      conversation_id: `fictional-source-${i}`,
      future_field: ["preserve", i],
    },
  }));
}

export function phrases3() {
  return ["daily", "business", "other"].map((category, i) => ({
    date_jst: "2026-10-18",
    entry_type: "phrase",
    category,
    study_japanese: `追加する架空のフレーズ${i + 1}。`,
    english: `Fictional added phrase ${i + 1}.`,
    katakana: "",
    explanation: "テスト用の架空の解説。",
    alternative_english: [`Another fictional phrase ${i + 1}.`],
  }));
}

export const oneRecord = () => ({
  sentence_id: "fiction-one",
  entry_id: "fiction-entry",
  date_jst: "2026-10-18",
  entry_type: "phrase",
  category: "daily",
  study_japanese: "これは架空の表現です。",
  english: "This is a fictional expression.",
  katakana: "フィクション",
  explanation: "実在しないテスト用の解説。",
  alternative_english: ["A fictional alternative."],
  extra_source: { keep: true },
});

export function diarySets(lengths = [2, 3, 4, 5]) {
  return lengths
    .flatMap((length, entry) =>
      Array.from({ length }, (_, index) => ({
        sentence_id: `fiction-set-${entry + 1}-sentence-${index + 1}`,
        entry_id: `fiction-set-${entry + 1}`,
        sentence_no: index + 1,
        entry_type: "diary",
        category: "diary",
        date_jst: `2026-10-${String(entry + 1).padStart(2, "0")}`,
        study_japanese: `架空の日記${entry + 1}：${index + 1}文目。`,
        english: `Fictional diary ${entry + 1}, sentence ${index + 1}.`,
        katakana:
          index === 1
            ? ""
            : `フィクショナル ダイアリー ${entry + 1} → ${index + 1}`,
        source_metadata: { fictional: true, position: index + 1 },
      })),
    )
    .reverse();
}
