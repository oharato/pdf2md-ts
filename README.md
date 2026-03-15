# pdf2md-ts

罫線あり表PDFを Markdown テーブルへ変換する TypeScript ライブラリ。

ラスタライズを一切行わず、PDF の**ベクトル罫線（constructPath + eoFill）**と**テキストボックス起点のレイキャスト**を組み合わせたハイブリッドアプローチで表を高精度に抽出します。
また、表以外の**フリーテキストの抽出**や、プラグイン機構を通じた**見出し判定・罫線なし表のカスタムレンダリング**にも対応しています。

---

## 要件

- Node.js >= 20
- pnpm

---

## セットアップ

```bash
git clone <repo>
cd pdf2md-ts
pnpm install
pnpm build
```

---

## CLI

### 基本

```bash
pnpm cli -- <input.pdf>
```

標準出力に Markdown を書き出します。

### オプション

| オプション | 説明 |
| --- | --- |
| `--out <path>` | 出力先ファイルパス（省略時は stdout） |
| `--page <n>` | 抽出するページ番号（省略時は全ページ） |
| `--debug-json <path>` | 中間テーブル構造を JSON で保存（デバッグ用） |

### 使用例

**ファイルへ保存する**

```bash
pnpm cli -- pdf/document.pdf --out md/document.md
```

**特定ページだけ抽出する**

```bash
pnpm cli -- pdf/document.pdf --page 3 --out md/document_p3.md
```

**中間 JSON を一緒に出力してデバッグする**

```bash
pnpm cli -- pdf/document.pdf --out md/document.md --debug-json md/document.debug.json
```

**複数 PDF を一括変換する（bash）**

```bash
for f in pdf/*.pdf; do
  base=$(basename "$f" .pdf)
  pnpm cli -- "$f" --out "md/${base}.md"
done
```

### 終了コード

| コード | 意味 |
| --- | --- |
| `0` | 正常終了 |
| `1` | 入力ファイルが見つからない、または解析エラー |

---

## API

```typescript
import { extractTablesFromPdf } from "@oharato/pdf2md-ts";

const result = await extractTablesFromPdf("pdf/document.pdf", {
  pages: [1, 2],   // 省略時は全ページ
  debug: true      // true にすると warnings が詳細になる
});

console.log(result.markdown);   // Markdown 文字列
console.log(result.tables);     // ページ単位の TableGrid[]
console.log(result.warnings);   // 警告メッセージ
```

### `ExtractOptions`

```typescript
type ExtractOptions = {
  pages?: number[];                 // 対象ページ番号（1-indexed）
  debug?: boolean;                  // デバッグモード
  plugins?: TextLinePlugin[];       // 見出し判定などのテキスト行プラグイン
  postProcessPlugins?: PageBlockPlugin[];         // ブロックレベルの事後処理プラグイン
  borderlessTablePlugins?: BorderlessTablePlugin[]; // 罫線なし表の描画プラグイン
};
```

### `ExtractResult`

```typescript
type ExtractResult = {
  tables: TableGrid[];   // ページごとのテーブル構造
  markdown: string;      // 全ページ分の Markdown
  warnings: string[];    // 警告（フォールバック発生時など）
};
```

---

## 開発コマンド

```bash
pnpm build        # TypeScript をコンパイル
pnpm test         # Vitest でテスト実行
pnpm test:watch   # ウォッチモード
pnpm lint         # oxlint で静的解析
```

---

## 制約・既知の制限

- **罫線あり表のみ対応**。罫線なし表やスキャン画像 PDF は非対象。
- セル結合（colspan / rowspan）は MVP では「左上セルに値を保持・他セルは空欄」で表現。
- PDF の表がページをまたぐ場合、ページ単位で独立した Markdown テーブルとして出力。

---

## 技術スタック

| ライブラリ | 役割 |
| --- | --- |
| `pdfjs-dist` | PDF 演算子列・テキスト抽出 |
| `rbush` | 空間インデックス（R-Tree） |
| `typescript` | 型安全な実装 |
| `@typescript/native-preview` | 開発実行基盤 |
| `vite` / `vitest` | ビルド・テスト基盤 |
| `oxlint` | 静的解析 |
