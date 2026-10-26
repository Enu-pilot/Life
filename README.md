# LifePlan

人生の選択（就職・転職・結婚・出産・住宅購入・退職など）が将来の収支・資産に与える影響を、複数のシナリオで比較・検証するための個人用ライフプランシミュレーション Web アプリです。データはブラウザ内（IndexedDB）にのみ保存し、外部サーバーへ送信しません。

> 計算結果は入力条件と計算前提に基づく試算（予測値）であり、将来を保証するものではありません。

## 起動方法

```bash
npm install
npm run build
npm run preview   # http://localhost:4173
```

開発用: `npm run dev`。使い方は [docs/user-guide.md](docs/user-guide.md) を参照してください。

## 主な機能

- プロフィール・前提条件、収入・支出（手取り入力／額面の簡易推計）、資産・負債、積立の入力と検証
- 人生イベント: 就職・転職・独立・退職、結婚・出産・教育費、賃貸・引っ越し・住宅購入（住宅ローン）、自動車、一時支出、年金（繰上げ・繰下げ）
- 月次計算・暦年集計の資産推移（グラフ・年次表・年次明細）、資金不足の検出と原因の確認、実質値表示、楽観・標準・悲観
- シナリオの複製・比較（最大 4 件）
- 自動保存、JSON バックアップ／復元（検証・確認・退避）、CSV 出力、データ形式の移行

## 開発

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | 型検査 |
| `npm test` | 単体・ゴールデン・プロパティ・クロスチェック・画面テスト（Vitest） |
| `npm run test:coverage` | カバレッジ |
| `npm run test:e2e` | E2E（Playwright, Chromium） |
| `npm run verify:golden` | 独立参照実装（Python）でゴールデンの期待値を再生成 |

開発ルールは [CLAUDE.md](CLAUDE.md)、各 Phase の報告は [docs/phase-reports.md](docs/phase-reports.md) を参照してください。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [user-guide.md](docs/user-guide.md) | 操作説明・データ保存・計算前提の要約 |
| [requirements.md](docs/requirements.md) | 要件と実装状況 |
| [calculation-spec.md](docs/calculation-spec.md) | 計算仕様 |
| [architecture.md](docs/architecture.md) | 構成・データ形式・依存パッケージ |
| [ui-design.md](docs/ui-design.md) | 画面設計 |
| [test-strategy.md](docs/test-strategy.md) | テスト方針と対応表 |
| [implementation-roadmap.md](docs/implementation-roadmap.md) | Phase と完了条件 |
| [open-questions.md](docs/open-questions.md) | 決定事項 |
| [phase-reports.md](docs/phase-reports.md) | Phase 完了報告 |
