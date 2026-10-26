# LifePlan アーキテクチャ設計書

- 文書状態: Phase 0 ドラフト（承認待ち）
- 最終更新: 2026-10-26

---

## 1. 調査結果（Phase 0 時点の開発環境）

| 項目 | 状況 |
|---|---|
| リポジトリ | `Enu-pilot/Life`。コミットなし・ファイルなし（新規プロジェクト） |
| 作業ブランチ | `claude/gallant-goodall-qu3bx2` |
| 既存の規約・構成 | なし（尊重すべき既存資産なし） |
| Node.js | v22.22.0（npm 10.9.4 / pnpm 10.28.0 / yarn 1.22.22 / bun 1.4.4 も利用可） |
| その他 | Python 3.13、Go 1.24（検証用スクリプトに利用可能） |
| npm レジストリ | 到達可能（主要パッケージの最新版: vite 8.3 / react 19.3 / typescript 7.0 / vitest 5.0 / recharts 3.10 / zod 4.6 / dexie 4.4 / @playwright/test 1.64） |
| ブラウザ | Chromium + Playwright がコンテナに導入済み（E2E テスト実行可能） |

## 2. 構成方針

- **SPA（シングルページアプリ）として静的ファイルのみで動作**させる。バックエンドサーバーは持たない。
- 層構造（依存は上から下への一方向のみ）:

```
┌──────────────────────────────────────────┐
│ UI 層 (src/ui)  React コンポーネント・画面・グラフ │
├──────────────────────────────────────────┤
│ アプリ層 (src/app)  状態管理・ユースケース       │
│   （シナリオ編集、再計算トリガー、保存の呼び出し）  │
├───────────────────┬──────────────────────┤
│ 計算エンジン        │ 永続化層 (src/storage)  │
│ (src/engine)       │ IndexedDB / JSON 入出力 │
│ 純粋 TS・DOM非依存   │ スキーマ検証・マイグレーション│
├───────────────────┴──────────────────────┤
│ ドメインモデル (src/domain)  型定義・スキーマ・ID │
└──────────────────────────────────────────┘
```

- `src/engine` は `src/domain` 以外を import しない（ESLint の import 制約で機械的に強制）。React・ブラウザ API に依存しないので Node 上の Vitest で高速にテストできる。
- 将来、計算を Web Worker に移す場合もエンジンをそのまま載せ替えられる。

## 3. 技術選定

### 3.1 比較と推奨

| 領域 | 候補 | 推奨 | 理由 |
|---|---|---|---|
| 言語 | TypeScript / JavaScript | **TypeScript (strict)** | 金額・月番号・ID の取り違えを型で防ぐ |
| ビルド | Vite / Next.js / CRA | **Vite** | 静的 SPA に最適。SSR 不要。設定が最小 |
| UI | React / Vue / Svelte | **React** | エコシステム（グラフ・フォーム・テスト）が最も厚い。【要決定 Q-14】 |
| ルーティング | React Router / TanStack Router / 自前 | **React Router（Hash ルーティング）** | 静的ホスティング・file 配信でもリロード可能 |
| 状態管理 | useReducer+Context / Zustand / Redux | **Zustand** | 小さく（~1KB）、ストア外（保存処理）からも扱いやすい。不要と判断すれば useReducer に置換可 |
| フォーム | React Hook Form / 自前 | **React Hook Form + Zod** | バリデーション定義をスキーマと共有 |
| スキーマ検証 | Zod / Valibot / 自前 | **Zod** | 型とランタイム検証を一元化。インポート時の検証に必須 |
| 計算エンジン | 自前 TS / 既存ライブラリ | **自前 TS（依存ゼロ）** | 仕様が独自。外部依存を持たせない |
| 数値精度 | number(整数円) / decimal.js | **number（整数円）** | calculation-spec §3。必要になった時点で再検討 |
| 保存 | localStorage / IndexedDB(Dexie) / IndexedDB(idb-keyval) / OPFS | **IndexedDB + idb-keyval** | localStorage は 5MB 制限・同期 API。データは「1ドキュメント」で足りるため Dexie のような DB 抽象は過剰。【要決定 Q-15】 |
| グラフ | Recharts / Chart.js / ECharts / uPlot | **Recharts** | React と宣言的に統合、積み上げ面・複合グラフ・参照線（イベント）が標準。データ点は最大 ~110 年分で性能問題なし |
| スタイル | CSS Modules / Tailwind / UI キット | **CSS Modules + 最小限の自前コンポーネント** | 依存を増やさない。UI キットは必要性が出たら検討 |
| 単体テスト | Vitest / Jest | **Vitest** | Vite と設定共有、高速 |
| プロパティテスト | fast-check | **fast-check（devDependency）** | 不変条件（残高恒等式等）をランダム入力で検証 |
| コンポーネントテスト | Testing Library | **@testing-library/react** | |
| E2E | Playwright / Cypress | **Playwright** | 環境に導入済み |
| Lint/Format | ESLint + Prettier / Biome | **ESLint + Prettier** | import 制約ルール（層分離）が必要なため ESLint |
| パッケージ管理 | npm / pnpm | **npm** | 追加ツール不要。lockfile をコミット |

依存は Phase 1 で導入するものに限定し、追加時は必要性を記録する（共通開発ルール 6）。

### 3.2 バージョン方針

- Node 22 LTS を前提（`.nvmrc` / `engines`）。
- 依存は lockfile で固定。TypeScript 7 系（ネイティブ実装）は周辺ツール（ESLint の typescript-eslint 等）の対応状況を Phase 1 で確認し、問題があれば 5.x 系を採用する。

## 4. ディレクトリ構成（案）

```
/
├─ docs/                      # 仕様書（本書含む）
├─ src/
│  ├─ domain/                 # 型・Zod スキーマ・ID 生成・定数（カテゴリ等）
│  │  ├─ schema/              # 保存データのスキーマ（バージョン別）
│  │  └─ types.ts
│  ├─ engine/                 # 計算エンジン（純粋関数）
│  │  ├─ time.ts              # 月番号・年齢・学齢
│  │  ├─ triggers.ts          # トリガー解決
│  │  ├─ events/              # イベント種別ごとの展開器
│  │  ├─ loan.ts              # ローン計算
│  │  ├─ ledger.ts            # 仕訳・残高
│  │  ├─ simulate.ts          # 月次ループ
│  │  ├─ aggregate.ts         # 年次集計・指標
│  │  ├─ validate.ts
│  │  └─ index.ts             # 公開 API: simulate(), validate()
│  ├─ storage/                # IndexedDB、エクスポート/インポート、マイグレーション
│  │  └─ migrations/
│  ├─ app/                    # ストア・ユースケース
│  ├─ ui/
│  │  ├─ pages/               # 画面（ui-design.md 準拠）
│  │  ├─ components/
│  │  └─ charts/
│  └─ main.tsx
├─ tests/
│  ├─ golden/                 # 手計算・独立実装による期待値ケース(JSON)
│  ├─ e2e/                    # Playwright
│  └─ fixtures/               # サンプルシナリオ・旧バージョンの保存データ
├─ tools/verify/              # 独立検証用スクリプト（Python）
└─ package.json
```

単体テストは対象ファイルと同階層に `*.test.ts` として置く。

## 5. データモデルと保存形式

### 5.1 保存データ（ルート）

```ts
type AppData = {
  schemaVersion: number;            // 整数。変更ごとに +1
  app: 'lifeplan';
  savedAt: string;                  // ISO 8601
  settings: {
    displayUnit: 'yen' | 'man';
    lastExportedAt?: string;
  };
  activeScenarioId: string;
  scenarios: Scenario[];
};

type Scenario = {
  id: string;                       // UUID
  name: string; description?: string;
  createdAt: string; updatedAt: string;
  copiedFrom?: string;              // 複製元（表示用。継承関係は持たない）
  assumptions: {
    startYearMonth: string;         // 'YYYY-MM'
    endAge: number;                 // 本人の終了年齢
    inflationRate: number;
    defaultReturnRate: number;
    autoLiquidate: boolean;         // 資金不足時の自動取り崩し
  };
  members: Member[];                // role: 'self' | 'spouse' | 'child'
  accounts: Account[];              // kind: calculation-spec §4
  flows: FlowItem[];                // 定常収支（calculation-spec §8）
  transfers: TransferRule[];        // 積立・取崩
  events: LifeEvent[];
};

type LifeEvent = {
  id: string;
  type: EventType;                  // 'one_time' | 'flow_change' | 'job_change' | 'retirement'
                                    // | 'marriage' | 'birth' | 'education' | 'rent'
                                    // | 'home_purchase' | 'car' | 'pension' ...
  name: string;
  enabled: boolean;
  trigger: Trigger;
  params: EventParams[EventType];   // 種別ごとの型（判別共用体）
  endsItemIds?: string[];           // この時点で終了させる既存収支項目
  memo?: string;
};
```

- **イベントの派生データは保存しない**（calculation-spec §1-3）。保存するのはパラメータのみ。
- イベント種別は「展開器（expander）」をレジストリに登録する方式とし、新種別の追加は `src/engine/events/` にファイルを1つ追加 + スキーマに型を追加するだけで済むようにする。

### 5.2 バージョン管理とマイグレーション

- `schemaVersion` は整数。v1 から開始。
- `src/storage/migrations/` に `v1→v2` のような**逐次マイグレーション関数**を置き、読み込み時に現在版まで順に適用する。
- マイグレーションごとに「旧版の保存データ fixture → 新版」のテストを必須とする（共通開発ルール 7）。
- アプリより新しい `schemaVersion` のデータは読み込みを拒否し、メッセージを表示する（データを壊さない）。
- 計算仕様のバージョン `engineVersion` とは独立。

### 5.3 永続化

- IndexedDB の単一キー（`lifeplan:data`）に `AppData` 全体を保存。編集後 500ms のデバウンスで自動保存。
- 直近の世代を最大 5 件、別キーにローテーション保存（誤操作からの復旧用。【要決定 Q-16】）。
- 起動時に `navigator.storage.persist()` を要求し、ブラウザによる自動削除を抑止する（許可されない場合は画面で注意表示）。

### 5.4 バックアップ・復元

| 項目 | 方式 |
|---|---|
| エクスポート | `AppData` を整形 JSON で `lifeplan-backup-YYYYMMDD-HHmm.json` としてダウンロード（Blob + `<a download>`）。外部送信なし |
| 付加情報 | `app`, `schemaVersion`, `savedAt`, `engineVersion`、内容の SHA-256（Web Crypto）を `integrity` として付与し、改変・破損を検出 |
| インポート | ファイル選択 → JSON パース → `app` 識別子確認 → integrity 照合（不一致は警告して続行可否を確認）→ マイグレーション → Zod 検証 → プレビュー（シナリオ数・名前・保存日時）→ 確認 → **現データを退避世代に保存してから**置換 |
| 失敗時 | いずれかの段階で失敗した場合、既存データは一切変更しない。エラー内容（どのフィールドか）を表示 |
| 暗号化 | 初期版なし（P3、Q-20 参照） |

## 6. 計算の実行モデル

- UI はシナリオが変化するたびに `simulate(scenario)` を呼び、結果をメモ化（シナリオのオブジェクト同一性で判定）。
- 1 シナリオ 50ms 以内を目標とし、メインスレッドで実行。比較画面で 4 シナリオ同時計算が重い場合のみ Web Worker 化する（P2）。

## 7. セキュリティ・プライバシー

- 外部通信なし（アナリティクス・エラー収集・外部 CDN・Web フォントの実行時読み込みを使わない）。CSP で `connect-src 'self'` に制限。
- インポート JSON は Zod で厳格に検証し、未知フィールドは除去する。HTML としてレンダリングしない（XSS 防止）。
- 配布方法（GitHub Pages 等の静的ホスティング／ローカル `npm run preview`）は【要決定 Q-17】。

## 8. 拡張ポイント

| 将来機能 | 拡張方法 |
|---|---|
| 新しいイベント種別 | 展開器を追加（§5.1） |
| 税・社保の詳細計算 | `src/engine/tax/` を追加し、`amountBasis: 'gross'` の収入を手取りに変換する前処理段として挿入。制度パラメータは年度付きデータファイル |
| モンテカルロ | `simulate` に利回り系列を外部注入できる引数を追加し、複数回実行して分位点を集計 |
| 差分方式シナリオ | `Scenario` に `baseScenarioId` + `overrides` を追加し、計算前に解決（マイグレーションで現行形式から移行） |
| クラウド同期 | 永続化層のアダプター差し替え |
