# 仕様書

## 1. システム構成
- 入力層: PDF読み込み。
- 解析層: テキストボックス抽出、ベクトル罫線抽出。
- 推論層: レイキャスト + ベクトルグリッド融合。
- 出力層: Markdownレンダリング。

## 2. データモデル
- `TextBox`: テキストとバウンディングボックス。
- `Segment`: 罫線候補の線分。
- `TableGrid`: 行列サイズ、セル配列、警告。
- `TableCell`: 行・列・文字列・結合情報。

## 3. 抽出アルゴリズム
1. PDFページから`TextBox`を抽出。
2. 演算子列から`Segment`を抽出。
3. 線分から縦横境界候補を作成。
4. 各`TextBox`中心から上下左右にレイを飛ばし、境界整合性を評価。
5. 文字を最適セルへ割り当て、`TableGrid`を構築。
6. 境界不足時は単一列フォールバック。

## 4. Markdown変換仕様
- 1行目をヘッダー行として出力。
- 区切り行は`---`固定。
- `|`はエスケープし、改行は`<br>`へ変換。
- 結合セルはMVPでは左上セル保持・他セル空欄で表現。

## 5. CLI仕様
- コマンド: `npm run build && npm run cli -- <input.pdf> [--out out.md] [--page N] [--debug-json out.json]`
- 出力:
  - `--out`指定時はファイルへ保存。
  - 未指定時は標準出力。
- 失敗時は標準エラーに理由を表示し、終了コード1。

## 6. API仕様
- 関数: `extractTablesFromPdf(filePath, options)`
- 戻り値:
  - `tables`: ページ単位の`TableGrid[]`
  - `markdown`: 結合済みMarkdown
  - `warnings`: 警告メッセージ

## 7. 品質保証
- Lint: `npm run lint`（`oxlint`）
- Test: `npm run test`（`vitest`）
- Build: `npm run build`（`typescript`）
- 開発基盤: `vite` を採用。
