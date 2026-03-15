# アーキテクチャ・アルゴリズム解説

## 1. 使用ライブラリ

### ランタイム依存

| ライブラリ | バージョン | 役割 |
| --- | --- | --- |
| `pdfjs-dist` | ^4.10.38 | PDFパース。テキスト内容・演算子列・ページメタデータを取得 |
| `rbush` | ^4.0.1 | R木（空間インデックス）。将来の空間クエリ最適化用途で組み込み済み |

### 開発依存

| ライブラリ | 役割 |
| --- | --- |
| `typescript` | 静的型付け。strict mode で全ファイルを型チェック |
| `@typescript/native-preview` | Rust製 TypeScript コンパイラのプレビュー版（高速ビルド実験） |
| `vite` | バンドル・開発サーバ基盤 |
| `vitest` | ユニットテスト・スナップショットテスト |
| `oxlint` | Rust製高速 Lint。`--deny-warnings` で警告をエラー扱い |
| `tsx` | `ts-node` 代替。診断スクリプトの直接実行に使用 |

---

## 2. 全体データフロー

```mermaid
flowchart TD
    PDF[("📄 PDF ファイル")]
    A["loadPdfDocument()\npdfjs-dist でページ取得"]
    B["extractTextBoxes()\nテキストアイテム → TextBox[]"]
    C["extractVectorSegments()\n演算子列 → Segment[]"]
    D["resolveTableGrids()\n融合・セル解決 → TableGrid[]"]
    E["renderPageContent()\nMarkdown 生成"]
    OUT[("📝 Markdown 出力")]

    PDF --> A
    A --> B & C
    B & C --> D
    D --> E
    B -->|"フリーテキスト\n(テーブル外)"| E
    E --> OUT
```

---

## 3. テキスト抽出（`textExtractor.ts`）

`pdfjs-dist` の `getTextContent()` が返す細粒度テキストアイテムを、
同一行・近接する要素同士でマージして `TextBox` に変換する。

```mermaid
flowchart LR
    RAW["pdfjs TextItem[]\n（文字・単語単位）"]
    BOLD["getOperatorList()\nrenderMode=2 → 太字判定"]
    MERGE["mergeIntoWords()\nY差 ≤2pt かつ X隙間 ≤14pt なら結合"]
    TB["TextBox[]\n{ text, bounds, fontSize, isBold }"]

    RAW --> MERGE
    BOLD --> MERGE
    MERGE --> TB
```

**マージ閾値**

| パラメータ | 値 | 意味 |
| --- | --- | --- |
| `SAME_LINE_Y_TOLERANCE` | 2 pt | 同行と判定する Y 方向の許容誤差 |
| `MAX_MERGE_GAP` | 14 pt | 同一単語と判定する X 方向の最大隙間 |

---

## 4. ベクトル罫線抽出（`operatorExtractor.ts`）

PDF の描画命令列（演算子リスト）を走査し、罫線に相当する細い矩形・ストローク矩形・パスを `Segment` に変換する。

```mermaid
flowchart TD
    OPS["PDF OperatorList\n(fnArray / argsArray)"]
    FILL["塗り潰し矩形\nconstructPath + eoFill"]
    STROKE["ストローク矩形\nrectangle + stroke"]
    PATH["任意パス\nlineTo / moveTo / ..."]

    THIN["thinRectToSegment()\nアスペクト比 >6 かつ 厚さ ≤3pt"]
    EDGES["pushStrokedRectEdges()\n4辺を個別 Segment に"]
    LINE["appendPathSegments()\npathコマンドを Segment 列に"]

    SEG["Segment[]\n{ id, x1,y1,x2,y2 }"]

    OPS --> FILL --> THIN --> SEG
    OPS --> STROKE --> EDGES --> SEG
    OPS --> PATH --> LINE --> SEG
```

**フィルタ閾値**

| パラメータ | 値 | 意味 |
| --- | --- | --- |
| `LINE_ASPECT_THRESHOLD` | 6 | 横÷縦（または縦÷横）がこれ以上の矩形のみ線とみなす |
| `MIN_LENGTH` | 2 pt | セグメント最小長（装飾点を除外） |
| `MAX_THICKNESS` | 3 pt | セグメント最大太さ（塗りつぶし領域を除外） |

---

## 5. レイキャスト（`raycast.ts`）

各 `TextBox` の中心から上下左右に仮想的なレイを飛ばし、最も近い `Segment` への距離を測る。
セルへの割り当て信頼度スコアとして利用する。

```mermaid
flowchart LR
    TB["TextBox\n中心座標 (cx, cy)"]
    UP["↑ up ray\n水平 Segment を探索"]
    DN["↓ down ray\n水平 Segment を探索"]
    LT["← left ray\n垂直 Segment を探索"]
    RT["→ right ray\n垂直 Segment を探索"]
    HIT["RayHit[]\n{ direction, segmentId, distance }"]

    TB --> UP & DN & LT & RT
    UP & DN & LT & RT --> HIT
```

`rayConfidence = hits.filter(h => h.segmentId !== null).length`  
→ 0 の場合はセグメント境界外とみなして配置をスキップ

---

## 6. テーブルグリッド解決（`cellResolver.ts`）

最も複雑な処理。ベクトルグリッドから `TableGrid` を構築する。

### 6-1. 全体フロー

```mermaid
flowchart TD
    SEG["Segment[]"]
    TB["TextBox[]"]

    HLINES["水平セグメント\nY座標リスト抽出"]
    VLINES["垂直セグメント\nX座標リスト抽出"]

    SPLIT["splitYLinesIntoGroups()\nグループ分割"]
    CHECK{垂直線あり?}

    GRID["buildTableGrid()\n完全格子テーブル"]
    HONLY["buildHLineOnlyTable()\n水平線のみテーブル\n（列はテキスト位置から推定）"]
    BORDERLESS["detectBorderlessTable()\n罫線なし2列テーブル"]

    PRUNE["pruneEmptyRowsAndCols()\n空行・空列を除去"]
    OUT["TableGrid[]"]

    SEG --> HLINES & VLINES
    TB --> GRID & HONLY & BORDERLESS
    HLINES --> SPLIT
    VLINES --> SPLIT
    SPLIT --> CHECK
    CHECK -->|"あり"| GRID
    CHECK -->|"なし"| HONLY
    GRID --> PRUNE
    HONLY --> PRUNE
    PRUNE --> OUT
    OUT --> BORDERLESS
    BORDERLESS --> OUT
```

### 6-2. Y行グループ分割

水平線の Y 座標群を「垂直セグメントの橋渡し」に基づいて独立テーブルに分割する。

```mermaid
flowchart TD
    YLIST["全 Y 座標（降順）"]
    ITER["隣接 Y ペアを順に処理"]
    BRIDGE{垂直 Segment が\n橋渡しするか?}
    RICH{橋渡し列数が\nMIN_RICH(=3) 以上?}
    SAME["同一グループに追加"]
    NEWSPLIT["新グループ開始"]

    YLIST --> ITER --> BRIDGE
    BRIDGE -->|"なし"| NEWSPLIT
    BRIDGE -->|"あり"| RICH
    RICH -->|"Rich→Sparse 変化"| NEWSPLIT
    RICH -->|"変化なし"| SAME
```

### 6-3. Y クラスタによるサブ行分割

同一グリッド行内に複数の Y クラスタが存在し、かつそれが **一部の列のみ** に集中している場合、行を実際のサブ行に分割する。これは純粋に位置ベースで、テキスト内容に依存しない。

```mermaid
flowchart TD
    ROW["グリッド行のテキストボックス群"]
    CLUSTER["Y座標を 10pt 閾値でクラスタリング"]
    COUNT{クラスタ数 ≥ 2?}
    COLS{トップクラスタが\n≥2列 かつ 全列未満?}
    SPLIT2["行を n サブ行に分割\nセル・cellBoxes を再配置"]
    NOOP["変更なし（単純多行セル）"]

    ROW --> CLUSTER --> COUNT
    COUNT -->|"No"| NOOP
    COUNT -->|"Yes"| COLS
    COLS -->|"No"| NOOP
    COLS -->|"Yes"| SPLIT2
```

**例：** 年度表記を含む表

```
┌──────────────────┬──────────────────┬──────────────────┐
│ 取引の種類        │ 同社に対する売上高│ 売上高全体に占める│
│                  │ ← Y=710 (高)     │ ← Y=710 (高)     │  ← ヘッダー行
├──────────────────┼──────────────────┼──────────────────┤
│                  │ (2026年2月期)     │ (2026年2月期)    │  ← Y=694 (高)
│ アフィリエイト   │ 121,454 千円      │ ※3.4%           │  ← Y=678 (低)
└──────────────────┴──────────────────┴──────────────────┘
```

col1・col2 は Y=694 と Y=678 の2クラスタ → 行を分割 → (2026年2月期) がヘッダーに昇格

---

## 7. Markdown レンダリング（`render.ts`）

### 7-1. 通常テーブル変換パイプライン

```mermaid
flowchart LR
    MAT["matrix\nstring[][]"]
    A["normalizeShiftedSparseColumns()\nシフトした疎列を正規化"]
    B["promoteSubHeaderPrefixes()\n括弧形式サブヘッダーをヘッダー行へ昇格"]
    C["extractInlineCellFootnotes()\nセル内 ※ 注記を表外へ抽出"]
    D["splitTrailingFootnoteRows()\n末尾の ※ 行を表外へ抽出"]
    OUT["Markdown テーブル文字列\n+ 脚注"]

    MAT --> A --> B --> C --> D --> OUT
```

### 7-2. ヘッダー昇格の判定ロジック（`promoteSubHeaderPrefixes`）

```mermaid
flowchart TD
    SCAN["全データ行を走査"]
    PAREN{"セル全体 or 先頭 <br> が\n括弧形式 (xxx) ?"}
    COUNT{"マッチ列数 ≥ 2 ?"}
    COL0{"Form1 の場合:\n先頭列は空か?"}
    PROMOTE["ヘッダー行に追記\n元セルから除去"]
    REMOVE["空になった行を削除"]
    NEXT["次の行へ"]

    SCAN --> PAREN
    PAREN -->|"No"| NEXT
    PAREN -->|"Yes"| COUNT
    COUNT -->|"No"| NEXT
    COUNT -->|"Yes"| COL0
    COL0 -->|"No"| NEXT
    COL0 -->|"Yes"| PROMOTE --> REMOVE --> NEXT
```

### 7-3. 罫線なし2列テーブルのヒューリスティック（`renderBorderlessTableToMarkdown`）

役員名簿パターン（氏名 + 役職 + 現職 + 新任/重任）を検出して構造化テーブルに変換する。

```mermaid
flowchart TD
    IN["2列 TableGrid\nisBorderless=true"]
    PARSE["各行を\n氏名 / 新役職 / 現役職 / 状態\nに分解"]
    VALID{"statusFilled ≥ 60%\ncurrentFilled ≥ 60%?"}
    STRUCT["構造化テーブル\n| 氏名 | 新役職 | 現役職 | 新任・重任 |"]
    SIMPLE["シンプル2列テーブル\n| 項目 | 内容 |"]

    IN --> PARSE --> VALID
    VALID -->|"Yes"| STRUCT
    VALID -->|"No"| SIMPLE
```

---

## 8. データ型の関係図

```mermaid
classDiagram
    class TextBox {
        +String id
        +String text
        +Bounds bounds
        +Number pageNumber
        +Number fontSize
        +Boolean isBold
    }
    class Segment {
        +String id
        +Number x1
        +Number y1
        +Number x2
        +Number y2
        +Number strokeWidth
    }
    class RayHit {
        +String direction
        +String segmentId
        +Number distance
    }
    class TableCell {
        +Number row
        +Number col
        +String text
        +Number rowSpan
        +Number colSpan
        +Bounds bounds
    }
    class TableGrid {
        +Number pageNumber
        +Number rows
        +Number cols
        +TableCell[] cells
        +String[] warnings
        +Number topY
        +Boolean isBorderless
    }
    class Bounds {
        +Number left
        +Number right
        +Number top
        +Number bottom
    }

    TextBox --> Bounds
    TextBox ..> RayHit : castRaysForTextBox()
    RayHit --> Segment : segmentId で参照
    TableGrid --> TableCell
```


## 8. プラグイン機構

テキストとテーブルのマークダウンへのレンダリングは、柔軟に拡張できるようにプラグイン化されています。

1. **TextLinePlugin**:
   フリーテキストの各行（1件のパラグラフ）に対して呼ばれるプラグイン。フォントサイズやテキストの内容から `# ` や `## ` などの見出し用の接頭辞（Prefix）を決定します。
2. **PageBlockPlugin**:
   改行区切りされたブロック（フリーテキストやテーブル）の配列全体を受け取り、前後の関連ブロックを結合したり、不要なブロック（ページ番号など）を削るような事後処理（Post Process）を行います。
3. **BorderlessTablePlugin**:
   完全に罫線に囲まれていない構造（段組みなど特定のパターン）を検出した際に、通常の Markdown テーブルではなく、リスト形式などカスタムのテキスト化を適用するためのプラグインです。


## 8. プラグイン機構

テキストとテーブルのマークダウンへのレンダリングは、柔軟に拡張できるようにプラグイン化されています。

1. **TextLinePlugin**:
   フリーテキストの各行（1件のパラグラフ）に対して呼ばれるプラグイン。フォントサイズやテキストの内容から `# ` や `## ` などの見出し用の接頭辞（Prefix）を決定します。
2. **PageBlockPlugin**:
   改行区切りされたブロック（フリーテキストやテーブル）の配列全体を受け取り、前後の関連ブロックを結合したり、不要なブロック（ページ番号など）を削るような事後処理（Post Process）を行います。
3. **BorderlessTablePlugin**:
   完全に罫線に囲まれていない構造（段組みなど特定のパターン）を検出した際に、通常の Markdown テーブルではなく、リスト形式などカスタムのテキスト化を適用するためのプラグインです。
