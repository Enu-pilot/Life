# Phase 完了報告

各 Phase 終了時の報告（implementation-roadmap.md §3 の形式）。

---

## Phase 1: アプリ基盤とデータ管理（2026-10-26）

### 1. 変更ファイル
- 設定: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `.gitignore`, `.nvmrc`
- ドメイン: `src/domain/{schema,time,money,format,categories,factory,refs}.ts`
- 永続化: `src/storage/{repository,backupFile}.ts`, `src/storage/migrations/index.ts`
- アプリ層: `src/app/store.ts`
- UI: `src/ui/**`（レイアウト、ダッシュボード、プロフィール・前提、収入・支出・資産、データ管理、設定・計算前提、共通部品）
- テスト: `src/**/*.test.ts(x)`, `tests/unit/*`, `tests/e2e/basic.spec.ts`
- 文書: `docs/architecture.md` §9、`docs/implementation-roadmap.md`（Phase 番号改訂）、`docs/open-questions.md`（全件決定）、`docs/calculation-spec.md` §14（子の生年月）

### 2. 実装内容
**実装済み**
- レイアウト（サイドナビ、ヘッダのシナリオ切替・前提チップ・保存状態表示）、Hash ルーティング
- ダッシュボード基本構成（初回の「はじめに」、入力値の要約、バックアップ未実施の注意、免責）
- プロフィール（本人・配偶者・子）と前提条件（開始年月・終了年齢・物価上昇率・既定利回り・自動取り崩し）
- 収入・支出（頻度・期間・上昇率・金額の基準時点）、資産・負債口座、積立・取崩のデータモデルと入力画面
- 入力検証: スキーマ（型・範囲）＋項目間（開始≦終了、生年月と開始年月、本人は 1 人、生活口座は 1 つ等）。項目直下とフォーム上部にエラー表示。「30万」「３０万円」「300,000」等の入力を解釈
- 参照されている要素の削除をブロック（参照元を表示）
- IndexedDB への自動保存（500ms デバウンス）。保存成功を確認してから「保存済み」。失敗時は赤字表示・再試行・エクスポート導線。保存中の追加編集は再保存
- 起動時の読み込みで欠損・破損・新しすぎる版を検出し、データを消さずに「生データの保存」「退避して新規開始」を選べる
- 全データ削除（確認文字列入力）、自動退避（最大 5 世代）と復元
- スキーマバージョン（v1）と逐次マイグレーションの枠組み
- エクスポート／インポート（整合性チェック・プレビュー・置換前退避）※ Phase 6 で強化予定

**未実装（後続 Phase）**
- 計算エンジン・資産推移（Phase 2）、人生イベント画面（Phase 3）、グラフ・シナリオ比較画面（Phase 4）。該当画面は「未実装」と表示

### 3. 実行したテストと結果
| コマンド | 結果 |
|---|---|
| `npx tsc -p .`（型検査） | 成功（エラー 0） |
| `npx vitest run` | 9 ファイル 101 件すべて成功（domain・storage・store・UI・層分離） |
| `npx playwright test`（Chromium） | 2 件成功（入力→自動保存→再読み込みで保持、外部通信なし） |
| `npm run build` | 成功 |

### 4. 完了条件
implementation-roadmap.md の Phase 1 項目をすべて満たした。

### 5. 既知の問題・制限
- 収支の「開始≦終了」検証は、年月指定同士のみ画面で検査（年齢・学齢指定は Phase 2 のエンジン検証で検査）
- スマートフォンは表示崩れしない程度（Q-22）

### 6. 決定事項・新たな未決事項
- Q-01〜Q-22 を推奨案で決定
- 子の生年月は将来（出産予定）も可とした（calculation-spec §14 を更新）
- テスト中に見つけて修正した不具合: シナリオ複製時の ID 変換が列挙値まで書き換える問題、年月入力の途中補正の問題

### 7. 次 Phase へ進む条件
- 利用者承認済み（Phase 1〜6 の連続実装）
