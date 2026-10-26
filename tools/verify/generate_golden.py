"""tests/golden/*.scenario.json から期待値 *.expected.json を生成する（独立参照実装による）。

使い方: python3 -I tools/verify/generate_golden.py
期待値ファイルは仕様変更の承認とセットでのみ更新すること（test-strategy §10）。
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import lifeplan_ref  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2] / "tests" / "golden"

for p in sorted(ROOT.glob("*.scenario.json")):
    sc = json.loads(p.read_text(encoding="utf-8"))
    years = lifeplan_ref.run(sc)
    out = {
        "generatedBy": "tools/verify/lifeplan_ref.py（calculation-spec に基づく独立実装、Decimal 40 桁）",
        "scenario": p.name,
        "years": years,
    }
    dst = p.with_name(p.name.replace(".scenario.json", ".expected.json"))
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{p.name}: {len(years)} 年 → {dst.name}")
