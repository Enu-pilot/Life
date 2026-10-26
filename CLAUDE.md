# LifePlan — 開発ガイド

ブラウザ内で完結するライフプランシミュレーション Web アプリ。仕様は `docs/` を正とする。

- 要件: docs/requirements.md
- 計算仕様: docs/calculation-spec.md
- 構成・データ形式: docs/architecture.md
- 画面: docs/ui-design.md
- テスト方針: docs/test-strategy.md
- Phase と完了条件: docs/implementation-roadmap.md
- 未決事項: docs/open-questions.md

## 共通開発ルール

1. 実装前に関連する仕様書と既存コードを確認する。
2. 仕様が曖昧な場合は、重大な判断を勝手に行わず、質問または判断案を提示する（docs/open-questions.md に起票）。
3. テストを通すために期待値や計算仕様を変更しない。
4. 計算ロジックは UI から独立させ（src/engine は src/domain 以外に依存しない）、独立した単体テストを用意する。
5. 既存機能を壊さないように回帰テストを実行する。
6. 依存パッケージを追加する場合は、その必要性を説明する。
7. データ形式や計算仕様を変更した場合は、関連ドキュメントと移行テストを更新する。
8. 実装した機能と未実装の機能を明確に区別する。
9. テストを実行していない場合、成功したと報告しない。
10. Phase の完了条件を満たさない場合、完了扱いにしない。

各 Phase の終了時には、変更ファイル、実装内容、実行したテストと結果、既知の問題、次の Phase へ進むための条件を報告する（形式: docs/implementation-roadmap.md §3）。
ユーザーの承認なしに次の Phase へ進まないこと。

## プライバシー

個人データを外部サーバーへ送信するコード（アナリティクス、外部 API、CDN からの実行時読み込み等）を追加しない。
