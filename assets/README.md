# PLAY BACKの提供素材

`playback-codex-assets.zip` に含まれていたユーザー提供の画像です。アプリ用のイラスト・ロゴ・PWAアイコンには、この素材だけを使用しています。元の画像ファイルは加工せずコピーしています。

| ファイル | 原寸 | 使用箇所 |
| --- | --- | --- |
| `playback-wordmark.png` | 1086 × 699 | 黒いヘッダー内の正式ロゴ。元の比率・字体・文字組みを保持 |
| `hero-grassland.webp` | 1448 × 1086 | ホーム。4:3の全体構図を保持し、文字の重ね合わせなし |
| `playback-icon-96.png` | 96 × 96 | ブラウザのfavicon |
| `playback-icon-192.png` | 192 × 192 | PWA通常アイコン・ホーム画面用リンク |
| `playback-icon-512.png` | 512 × 512 | PWA通常アイコン |
| `playback-icon-maskable-512.png` | 512 × 512 | Android向け専用maskableアイコン |

元のZIPから取得したSHA-256を `tests/branding.test.js` で照合します。画像生成、フォントの再制作、色調変更、トリミング、構図の描き足しは行っていません。
