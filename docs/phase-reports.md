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
| `npx vitest run` | 6 ファイル 101 件すべて成功（domain・storage・store・UI・層分離） |
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

---

## Phase 2: 計算エンジン（2026-10-26）

### 1. 変更ファイル
- エンジン: `src/engine/{types,triggers,ledger,loan,compile,simulate,aggregate,explain,index}.ts`, `src/engine/events/{registry,index}.ts`
- ドメイン: `src/domain/money.ts`（浮動小数の正規化）
- 独立参照実装: `tools/verify/{lifeplan_ref,generate_golden,run_batch}.py`
- テスト: `src/engine/{simulate,triggers}.test.ts`, `tests/unit/{golden,property,crosscheck,arbitraries}.ts`, `tests/golden/*`
- UI（結果の表示）: `src/ui/useSimulation.ts`, `src/ui/components/{Issues,YearTable,YearDetail}.tsx`, `src/ui/pages/{DashboardPage,ProjectionPage}.tsx`, `src/ui/validators.ts`
- 文書: `docs/calculation-spec.md` §3・§16

### 2. 実装内容
**実装済み**
- 月次計算・暦年集計。処理順序は calculation-spec §7 のとおり
- 年齢・年月・学齢によるトリガー解決（開始・終了、「X歳になる前月まで／X歳の間も含む」、年齢期間中の指定月）
- 上昇率（固定率・物価連動、適用月、金額の基準時点）
- 仕訳モデル（一意キーによる二重計上の検出、0 円仕訳なし、負債は借入で増・元本返済で減）
- 生活口座・預金・投資・実物資産・負債の残高、運用損益（幾何月次換算）、評価損益
- 既存ローン（元利均等・元金均等、円未満切り捨て、最終回精算、金利変更時の再計算）
- 資金不足の検出（初回月・最大不足額・月数・最低残高）と自動取り崩し（オプション）
- 結果の要約（開始・65 歳・終了時の純資産、ローン完済月、生涯収入・支出）と年次の内訳説明
- 検証（本人なし、終了年齢、ID 重複、口座指定、参照切れ、期間逆転、住居費の重複）
- 資産推移の年次表と年次明細（期首→期末の内訳、出所別の収支）、ダッシュボードの指標

**未実装（実装済みとして扱わない）**
- 税金・社会保険料の計算（収入は手取り入力）
- 運用益への課税（税引後利回りを入力）
- 人生イベントの展開（Phase 3）。この時点ではイベントは「未対応の種別」として警告し計算に含めない

### 3. 実行したテストと結果
| コマンド | 結果 |
|---|---|
| `npx tsc -p .` | 成功 |
| `npx vitest run` | 11 ファイル 154 件すべて成功 |
| `npm run verify:golden`（Python 独立実装で期待値生成） | 4 ケース生成 |

必須検証の対応: 収支なし／収入>支出／支出>収入／初期資産ゼロ／途中変更／長期間（1,320 か月）／月末・年末境界／丸めと浮動小数／決定性 → すべて `src/engine/simulate.test.ts` に手計算または Python Decimal の期待値で実装し成功。

カバレッジ（参考）: engine 全体 行 79%。未カバーの大半はイベント展開（Phase 3 で対象）。

### 4. 完了条件
Phase 2 の項目をすべて満たした（カバレッジ目標は Phase 6 で最終確認）。

### 5. 既知の問題・制限・テスト中の発見
- **発見して修正**: 倍精度の表現誤差で `100 × 1.005` が 100 円に丸まり、ローン利息が 1 円少なくなる問題。有効数字 15 桁に正規化してから丸める方式に変更し、仕様書に追記した
- **期待値の訂正（独立計算による）**: テストに書いた手計算の誤り 2 件（333,333×1.015^10 の値、自動取り崩しの不足月数）を Python Decimal と再計算で確認して訂正した。実装に合わせて変えたものではない
- 性能はテスト環境で 1,320 か月を 500ms 未満で確認（要件 50ms の計測は Phase 6）

### 6. 決定事項
calculation-spec §16 に記載。

### 7. 次 Phase へ進む条件
承認済み（連続実装）。
