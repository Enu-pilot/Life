# LifePlan

人生の選択（就職・転職・結婚・出産・住宅購入・退職など）が将来の収支・資産に与える影響を、複数シナリオで比較・検証するための個人用ライフプランシミュレーション Web アプリです。データはブラウザ内にのみ保存し、外部サーバーへ送信しません。

> 現在 **Phase 0（要件定義・設計）** です。アプリ本体は未実装です。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [requirements.md](docs/requirements.md) | 目的・機能要件（優先度別）・非機能要件 |
| [calculation-spec.md](docs/calculation-spec.md) | 計算モデル（月次計算、仕訳モデル、ローン、資金不足、税の扱い） |
| [architecture.md](docs/architecture.md) | 技術構成、データモデル、保存・バックアップ方式 |
| [ui-design.md](docs/ui-design.md) | 画面構成・遷移・入力項目・バリデーション |
| [test-strategy.md](docs/test-strategy.md) | テスト方針と検証ケース |
| [implementation-roadmap.md](docs/implementation-roadmap.md) | Phase 別の実装順序と完了条件 |
| [open-questions.md](docs/open-questions.md) | 未決事項（選択肢・推奨案・理由） |

開発ルールは [CLAUDE.md](CLAUDE.md) を参照してください。

## 免責

本アプリの計算結果は入力条件と計算前提に基づく試算であり、将来を保証するものではありません。
