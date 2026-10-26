"""標準入力のシナリオ配列（JSON）を参照実装で計算し、年次結果の配列を標準出力に書く（クロスチェック用）。"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import lifeplan_ref  # noqa: E402

scenarios = json.load(sys.stdin)
json.dump([lifeplan_ref.run(s) for s in scenarios], sys.stdout)
