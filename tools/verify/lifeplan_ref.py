"""LifePlan 計算仕様の独立参照実装（検証専用）。

docs/calculation-spec.md の記述のみに基づいて実装しており、src/engine のコードは参照・移植していない。
浮動小数ではなく 40 桁の Decimal で計算し、TypeScript 実装（倍精度浮動小数）の結果と完全一致比較する。

対応範囲:
  Phase 2: 定常収支（頻度・期間・上昇率）、積立・取崩、運用・利息、実物資産の評価変動、既存ローン、資金不足・自動取り崩し
  Phase 3: イベント one_time / flow_change / job / retirement / marriage / birth / rent / home_purchase / car / pension / education
"""
from __future__ import annotations

from decimal import Decimal as D, ROUND_FLOOR, getcontext

getcontext().prec = 40

EXTERNAL = "EXTERNAL"


# ---------- 時間（§2） ----------

def ym(s: str) -> int:
    y, m = s.split("-")
    return int(y) * 12 + int(m) - 1


def year_of(m: int) -> int:
    return m // 12


def cal_month(m: int) -> int:
    return m % 12 + 1


def elementary_entry(birth: int) -> int:
    by, bm = year_of(birth), cal_month(birth)
    return (by + 7 if bm >= 4 else by + 6) * 12 + 3


STAGE_OFFSET = {"kindergarten": -3, "elementary": 0, "junior": 6, "high": 9, "university": 12}
STAGE_YEARS = {"kindergarten": 3, "elementary": 6, "junior": 3, "high": 3, "university": 4}


def stage_entry(birth: int, stage: str) -> int:
    return elementary_entry(birth) + STAGE_OFFSET[stage] * 12


class Unresolved(Exception):
    pass


def _birth(births, mid):
    if mid not in births:
        raise Unresolved(mid)
    return births[mid]


def _within_age(b, age, month):
    for k in range(b + age * 12, b + age * 12 + 12):
        if cal_month(k) == month:
            return k
    raise AssertionError


def t_start(t, births):
    if t["type"] == "date":
        return ym(t["ym"])
    if t["type"] == "age":
        b = _birth(births, t["memberId"])
        return _within_age(b, t["age"], t["month"]) if t.get("month") else b + t["age"] * 12
    return stage_entry(_birth(births, t["memberId"]), t["stage"])


def t_end(t, births):
    if t["type"] == "date":
        return ym(t["ym"])
    if t["type"] == "age":
        b = _birth(births, t["memberId"])
        if t.get("month"):
            return _within_age(b, t["age"], t["month"])
        if t.get("endMode") == "through":
            return b + (t["age"] + 1) * 12 - 1
        return b + t["age"] * 12 - 1
    return stage_entry(_birth(births, t["memberId"]), t["stage"]) - 1


# ---------- 金額（§3） ----------

def round_yen(x: D) -> int:
    """0 から遠い方向への四捨五入"""
    a = abs(x)
    r = int((a + D("0.5")).to_integral_value(rounding=ROUND_FLOOR))
    return r if x >= 0 else -r


def floor_yen(x: D) -> int:
    return int(x.to_integral_value(rounding=ROUND_FLOOR))


def monthly_rate(annual) -> D:
    a = D(str(annual))
    if a == 0:
        return D(0)
    return (D(1) + a) ** (D(1) / D(12)) - D(1)


def steps(base: int, m: int, step_month: int) -> int:
    """base より後かつ m 以前に step_month を迎えた回数（§8.2）"""
    n = 0
    for k in range(base + 1, m + 1):
        if cal_month(k) == step_month:
            n += 1
    return n


def amount_at(rule, m, inflation) -> D:
    g = rule["growth"]
    amt = D(str(rule["amount"]))
    if g["type"] == "none":
        return amt
    rate = D(str(inflation)) if g["type"] == "inflation" else D(str(g["rate"]))
    return amt * (D(1) + rate) ** steps(rule["base"], m, rule["step"])


# ---------- シミュレーション ----------

class Sim:
    def __init__(self, sc):
        self.sc = sc
        a = sc["assumptions"]
        self.start = ym(a["startYm"])
        self.self_m = next(m for m in sc["members"] if m["role"] == "self")
        self.end = ym(self.self_m["birthYm"]) + a["endAge"] * 12
        self.inflation = a["inflationRate"]
        self.auto_liq = a["autoLiquidate"]
        self.births = {m["id"]: ym(m["birthYm"]) for m in sc["members"]}
        self.kind = {}
        self.bal = {}  # 資産は正、負債も正（liability）で保持
        self.rate = {}
        self.order = []
        for acc in sc["accounts"]:
            self.add_account(acc["id"], acc["kind"], acc["openingBalance"], acc["annualRate"])
        self.cash = next(x["id"] for x in sc["accounts"] if x["kind"] == "cash")
        self.flows = []  # dict(dir, cat, from, to, amount, months, growth, base, step, src)
        self.transfers = []
        self.onetimes = []  # (month, key, kind, payload)
        self.loans = []
        self.opening = {k: v for k, v in self.bal.items()}

    def add_account(self, aid, kind, opening, rate):
        self.kind[aid] = kind
        self.bal[aid] = opening
        self.rate[aid] = rate
        self.order.append(aid)

    def resolve_period(self, start_t, end_t):
        f = t_start(start_t, self.births) if start_t else self.start
        t = t_end(end_t, self.births) if end_t else self.end
        return f, t

    def flow_rule(self, f, frm, to, src):
        return {
            "dir": f["direction"], "cat": f["category"], "from": frm, "to": to,
            "amount": f["amount"], "months": None if f["frequency"] == "monthly" else (f.get("months") or []),
            "growth": f["growth"], "base": self.start if f["growthBase"] == "start" else frm,
            "step": f["growthStepMonth"], "src": src,
        }

    # 口座間の移動（from の残高を減らし to を増やす。負債は逆向き）
    def move(self, frm, to, amt):
        assert isinstance(amt, int) and amt >= 0
        if frm != EXTERNAL:
            self.bal[frm] += amt if self.kind[frm] == "loan" else -amt
        if to != EXTERNAL:
            self.bal[to] += -amt if self.kind[to] == "loan" else amt


def compile_base(sim: Sim):
    sc = sim.sc
    for f in sc["flows"]:
        try:
            frm, to = sim.resolve_period(f.get("start"), f.get("end"))
        except Unresolved:
            continue
        sim.flows.append(sim.flow_rule(f, frm, to, f["id"]))
    for t in sc["transfers"]:
        frm, to = sim.resolve_period(t.get("start"), t.get("end"))
        r = sim.flow_rule({**t, "direction": "transfer", "category": "transfer"}, frm, to, t["id"])
        r["fromId"], r["toId"] = t["fromId"], t["toId"]
        sim.transfers.append(r)
    for acc in sc["accounts"]:
        if acc["kind"] == "loan":
            sim.loans.append(Loan(acc["id"], sim.start, acc["loan"]["remainingMonths"], acc["loan"]["method"], acc["annualRate"], []))


class Loan:
    def __init__(self, aid, first, term, method, rate, changes):
        self.aid, self.first, self.term, self.method, self.rate, self.changes = aid, first, term, method, rate, changes
        self.made = 0
        self.cur = None
        self.pay = 0
        self.ppart = 0

    def rate_at(self, m):
        r = self.rate
        for (cm, cr) in self.changes:
            if cm <= m:
                r = cr
        return r

    def payment(self, m, balance):
        if m < self.first or balance <= 0:
            return None
        remaining = self.term - self.made
        rate = self.rate_at(m)
        r = D(str(rate)) / D(12)
        if self.cur is None or rate != self.cur:
            self.cur = rate
            n = max(remaining, 1)
            if r == 0:
                self.pay = floor_yen(D(balance) / D(n))
            else:
                self.pay = floor_yen(D(balance) * r / (D(1) - (D(1) + r) ** (-n)))
            self.ppart = floor_yen(D(balance) / D(n))
        interest = floor_yen(D(balance) * r)
        if remaining <= 1:
            principal = balance
        elif self.method == "equal_payment":
            principal = max(0, min(balance, self.pay - interest))
        else:
            principal = min(balance, self.ppart)
        self.made += 1
        return interest, principal


def prepare_events(sim):
    pass


def expand_events(sim):
    pass


def occurs(r, m):
    return r["from"] <= m <= r["to"] and (r["months"] is None or cal_month(m) in r["months"])


def run(sc):
    sim = Sim(sc)
    prepare_events(sim)  # イベント発生月と派生メンバー（Phase 3）
    compile_base(sim)
    expand_events(sim)  # イベントの展開と終了指定（Phase 3）
    rows = []
    FIN = ("cash", "savings", "investment")
    for m in range(sim.start, sim.end + 1):
        tot = {"income": 0, "expense": 0, "invret": 0, "reval": 0, "principal": 0}
        # 2. 運用・利息
        for aid in sim.order:
            k = sim.kind[aid]
            if k not in FIN or sim.rate[aid] == 0 or sim.bal[aid] <= 0:
                continue
            r = round_yen(D(sim.bal[aid]) * monthly_rate(sim.rate[aid]))
            if r > 0:
                sim.move(EXTERNAL, aid, r)
                tot["invret"] += r
            elif r < 0:
                x = min(-r, sim.bal[aid])
                sim.move(aid, EXTERNAL, x)
                tot["invret"] -= x
        # 3. 評価変動
        for aid in sim.order:
            if sim.kind[aid] not in ("property", "vehicle", "other_asset") or sim.rate[aid] == 0 or sim.bal[aid] <= 0:
                continue
            r = round_yen(D(sim.bal[aid]) * monthly_rate(sim.rate[aid]))
            if r > 0:
                sim.move(EXTERNAL, aid, r)
                tot["reval"] += r
            elif r < 0:
                x = min(-r, sim.bal[aid])
                sim.move(aid, EXTERNAL, x)
                tot["reval"] -= x
        # 4. 収入
        for f in sim.flows:
            if f["dir"] == "income" and occurs(f, m):
                a = round_yen(amount_at(f, m, sim.inflation))
                if a > 0:
                    sim.move(EXTERNAL, sim.cash, a)
                    tot["income"] += a
        # 5. 一時（キー順）
        for (om, key, kind, p) in sorted([o for o in sim.onetimes if o[0] == m], key=lambda o: o[1]):
            if kind == "sellAll":
                b = sim.bal[p["account"]]
                if b > 0:
                    sim.move(p["account"], p["to"], b)
                continue
            if p["amount"] == 0:
                continue
            sim.move(p["from"], p["to"], p["amount"])
            if p["type"] == "income":
                tot["income"] += p["amount"]
            elif p["type"] == "expense":
                tot["expense"] += p["amount"]
        # 6. 支出
        for f in sim.flows:
            if f["dir"] == "expense" and occurs(f, m):
                a = round_yen(amount_at(f, m, sim.inflation))
                if a > 0:
                    sim.move(sim.cash, EXTERNAL, a)
                    tot["expense"] += a
        # 7. ローン
        for ln in sim.loans:
            pay = ln.payment(m, sim.bal[ln.aid])
            if pay is None:
                continue
            i, p = pay
            sim.move(sim.cash, EXTERNAL, i)
            sim.move(sim.cash, ln.aid, p)
            tot["expense"] += i
            tot["principal"] += p
        # 8. 振替
        for t in sim.transfers:
            if not occurs(t, m):
                continue
            a = round_yen(amount_at(t, m, sim.inflation))
            if t["fromId"] != sim.cash:
                a = min(a, max(0, sim.bal[t["fromId"]]))
            if a > 0:
                sim.move(t["fromId"], t["toId"], a)
        # 9. 自動取り崩し
        if sim.auto_liq and sim.bal[sim.cash] < 0:
            for aid in [x for x in sim.order if sim.kind[x] == "savings"] + [x for x in sim.order if sim.kind[x] == "investment"]:
                need = -sim.bal[sim.cash]
                if need <= 0:
                    break
                take = min(need, max(0, sim.bal[aid]))
                if take > 0:
                    sim.move(aid, sim.cash, take)
        fin = sum(sim.bal[a] for a in sim.order if sim.kind[a] in FIN)
        real = sum(sim.bal[a] for a in sim.order if sim.kind[a] in ("property", "vehicle", "other_asset"))
        liab = sum(sim.bal[a] for a in sim.order if sim.kind[a] == "loan")
        rows.append({"month": m, **tot, "cash": sim.bal[sim.cash], "fin": fin, "real": real, "liab": liab})
    # 年次集計（暦年）
    years = []
    for r in rows:
        y = year_of(r["month"])
        if not years or years[-1]["year"] != y:
            years.append({"year": y, "income": 0, "expense": 0, "investmentReturn": 0, "revaluation": 0, "loanPrincipal": 0})
        Y = years[-1]
        Y["income"] += r["income"]
        Y["expense"] += r["expense"]
        Y["investmentReturn"] += r["invret"]
        Y["revaluation"] += r["reval"]
        Y["loanPrincipal"] += r["principal"]
        Y["cash"] = r["cash"]
        Y["financialAssets"] = r["fin"]
        Y["realAssets"] = r["real"]
        Y["liabilities"] = r["liab"]
        Y["netWorth"] = r["fin"] + r["real"] - r["liab"]
    return years
