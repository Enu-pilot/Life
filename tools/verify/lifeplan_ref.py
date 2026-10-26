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
    a = annual if isinstance(annual, D) else D(str(annual))
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


def _d(x) -> D:
    return x if isinstance(x, D) else D(str(x))


def amount_at(rule, m, inflation) -> D:
    g = rule["growth"]
    amt = _d(rule["amount"])
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
            # 手数料は利回りから差し引く（§18）
            self.add_account(acc["id"], acc["kind"], acc["openingBalance"], D(str(acc["annualRate"])) - D(str(acc.get("feeRate", 0))))
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
            "amount": (D(str(f["amount"])) * D(str(f["netRatio"]))) if (f["direction"] == "income" and f.get("netRatio") is not None) else f["amount"], "months": None if f["frequency"] == "monthly" else (f.get("months") or []),
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
    sim.event_month = getattr(sim, "event_month", {})
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


# ---------- 人生イベント（§17） ----------

EDU = {
    "kindergarten:public": 184646, "kindergarten:private": 347338,
    "elementary:public": 366599, "elementary:private": 1741516,
    "junior:public": 542450, "junior:private": 1560359,
    "high:public": 596954, "high:private": 1179261,
    "university:national": 1035000, "university:private_arts": 1520000, "university:private_science": 1832000,
}
ENTRANCE = {"national": 672000, "private_arts": 818000, "private_science": 888000}


def prepare_events(sim):
    """有効なイベントの発生月を解決し、結婚・出産で追加されるメンバーの生年月を登録する"""
    sim.event_month = {}
    pending = [e for e in sim.sc["events"] if e["enabled"]]
    for _ in range(len(pending) + 1):
        rest = []
        for e in pending:
            try:
                m = t_start(e["trigger"], sim.births)
            except Unresolved:
                rest.append(e)
                continue
            sim.event_month[e["id"]] = m
            if e["type"] == "marriage":
                sim.births[e["id"] + ":spouse"] = ym(e["params"]["spouseBirthYm"])
            if e["type"] == "birth":
                sim.births[e["id"] + ":child"] = m
        if len(rest) == len(pending):
            break
        pending = rest


def _price_at(sim, amount, growth, m):
    return round_yen(amount_at({"amount": amount, "growth": growth, "base": sim.start, "step": 1}, m, sim.inflation))


def _post(sim, eid, key, m, typ, frm, to, amount):
    sim.onetimes.append((m, f"{eid}:{key}", "post", {"type": typ, "from": frm, "to": to, "amount": amount}))


def _cash_once(sim, eid, key, direction, amount, m, endable=False):
    if amount <= 0:
        return
    if direction == "income":
        _post(sim, eid, key, m, "income", EXTERNAL, sim.cash, amount)
    else:
        _post(sim, eid, key, m, "expense", sim.cash, EXTERNAL, amount)
    if endable:
        sim.endable.append((sim.onetimes[-1], eid))


def _template(sim, eid, t, month):
    to = t_end(t["end"], sim.births) if t.get("end") else sim.end
    r = sim.flow_rule(t, month, to, eid)
    sim.flows.append(r)


def _flow(sim, eid, direction, frm, to, amount, months, growth, step):
    sim.flows.append({"dir": direction, "cat": "", "from": frm, "to": to, "amount": amount, "months": months,
                      "growth": growth, "base": sim.start, "step": step, "src": eid})


def _loan(sim, aid, amount, to_acct, draw_m, terms, eid, key):
    if amount <= 0:
        return
    sim.add_account(aid, "loan", 0, terms["annualRate"])
    _post(sim, eid, key, draw_m, "loan_draw", aid, to_acct, amount)
    first = draw_m + 1
    changes = sorted((first + c["afterMonths"], c["annualRate"]) for c in terms["rateChanges"])
    sim.loans.append(Loan(aid, first, terms["termMonths"], terms["method"], terms["annualRate"], changes))


def expand_events(sim):
    sim.endable = []
    evs = [e for e in sim.sc["events"] if e["enabled"] and e["id"] in sim.event_month]
    evs.sort(key=lambda e: (sim.event_month[e["id"]], e["type"], e["id"]))
    for e in evs:
        m = sim.event_month[e["id"]]
        if m > sim.end:
            continue
        eid, p, t = e["id"], e["params"], e["type"]
        try:
            if t == "one_time":
                _cash_once(sim, eid, "main", p["direction"], _price_at(sim, p["amount"], p["growth"], m), m)
            elif t in ("flow_change", "job", "retirement", "marriage", "birth"):
                if t == "job":
                    _cash_once(sim, eid, "cost", "expense", p["cost"], m)
                if t == "retirement":
                    _cash_once(sim, eid, "severance", "income", p["severance"], m)
                if t in ("marriage", "birth"):
                    _cash_once(sim, eid, "cost", "expense", p["cost"], m)
                for f in p["flows"]:
                    _template(sim, eid, f, m)
            elif t == "education":
                b = _birth(sim.births, p["memberId"])
                for stage in ("kindergarten", "elementary", "junior", "high", "university"):
                    course = p[stage]
                    if course == "none":
                        continue
                    key = f"{stage}:{course}"
                    annual = p["overrides"].get(key, EDU.get(key))
                    entry = stage_entry(b, stage)
                    _flow(sim, eid, "expense", entry, entry + STAGE_YEARS[stage] * 12 - 1, D(annual) / D(12), None, p["growth"], 1)
                    if stage == "university":
                        ent = p["overrides"].get(f"university_entrance:{course}", ENTRANCE[course])
                        _cash_once(sim, eid, "entrance", "expense", _price_at(sim, ent, p["growth"], entry), entry)
            elif t == "rent":
                to = t_end(p["end"], sim.births) if p.get("end") else sim.end
                _flow(sim, eid, "expense", m, to, p["monthlyRent"], None, p["growth"], 1)
                _cash_once(sim, eid, "initial", "expense", p["initialCost"], m)
                if p["renewalFee"] > 0 and p["renewalIntervalYears"] > 0:
                    k, rm = 1, m + 12 * p["renewalIntervalYears"]
                    while rm <= to:
                        fee = round_yen(amount_at({"amount": p["renewalFee"], "growth": p["growth"], "base": sim.start, "step": 1}, rm, sim.inflation))
                        _cash_once(sim, eid, f"renewal{k:02d}", "expense", fee, rm, endable=True)
                        k, rm = k + 1, rm + 12 * p["renewalIntervalYears"]
            elif t == "home_purchase":
                if p["downPayment"] > p["price"]:
                    continue
                prop = eid + ":property"
                sim.add_account(prop, "property", 0, p["revaluationRate"])
                if p["downPayment"] > 0:
                    _post(sim, eid, "a-down", m, "asset_purchase", sim.cash, prop, p["downPayment"])
                _loan(sim, eid + ":loan", p["price"] - p["downPayment"], prop, m, p["loan"], eid, "b-draw")
                _cash_once(sim, eid, "c-costs", "expense", p["closingCosts"], m)
                if p["maintenanceMonthly"] > 0:
                    _flow(sim, eid, "expense", m, sim.end, p["maintenanceMonthly"], None, p["maintenanceGrowth"], 1)
                if p["propertyTaxYearly"] > 0:
                    _flow(sim, eid, "expense", (year_of(m) + 1) * 12 + 3, sim.end, p["propertyTaxYearly"], [4], {"type": "none"}, 1)
            elif t == "car":
                veh = eid + ":vehicle"
                sale = t_start(p["holdUntil"], sim.births) if p.get("holdUntil") else None
                last = min(sale - 1, sim.end) if sale is not None else sim.end
                sim.add_account(veh, "vehicle", 0, p["depreciationRate"])
                count = p["purchaseCount"] if p["cycleYears"] > 0 else 1
                for k in range(count):
                    pm = m + k * p["cycleYears"] * 12
                    if pm > last:
                        break
                    tag = f"k{k:02d}"
                    price = _price_at(sim, p["price"], p["priceGrowth"], pm)
                    if k > 0:
                        sim.onetimes.append((pm, f"{eid}:{tag}-1sell", "sellAll", {"account": veh, "to": sim.cash}))
                    if p["loan"]:
                        down = min(p["downPayment"], price)
                        if down > 0:
                            _post(sim, eid, f"{tag}-2down", pm, "asset_purchase", sim.cash, veh, down)
                        _loan(sim, f"{eid}:loan{k}", price - down, veh, pm, p["loan"], eid, f"{tag}-3draw")
                    elif price > 0:
                        _post(sim, eid, f"{tag}-2buy", pm, "asset_purchase", sim.cash, veh, price)
                if p["maintenanceYearly"] > 0:
                    _flow(sim, eid, "expense", m, last, D(p["maintenanceYearly"]) / D(12), None, p["maintenanceGrowth"], 1)
                if sale is not None and sale <= sim.end:
                    sim.onetimes.append((sale, f"{eid}:z-final-sell", "sellAll", {"account": veh, "to": sim.cash}))
            elif t == "pension":
                if p["memberId"] not in sim.births:
                    continue
                annual = D(p["annualAmount"])
                tr = e["trigger"]
                if p.get("claimAdjustment") and tr["type"] == "age" and tr["memberId"] == p["memberId"] and not tr.get("month"):
                    # 繰上げ: 0.4%/月（1962-04 以降生まれ）・0.5%/月（それより前）、60 歳から
                    # 繰下げ: 0.7%/月、66 歳から、上限 75 歳（1952-04 以降生まれ）・70 歳（それより前）
                    b = sim.births[p["memberId"]]
                    age = tr["age"]
                    months = (age - 65) * 12
                    max_age = 75 if b >= ym("1952-04") else 70
                    if 60 <= age <= max_age and not (0 < months < 12):
                        if months < 0:
                            rate = D("0.004") if b >= ym("1962-04") else D("0.005")
                        else:
                            rate = D("0.007")
                        annual = annual * (D(1) + rate * months)
                g = {"type": "none"} if p["slideRate"] == 0 else {"type": "fixed", "rate": p["slideRate"]}
                _flow(sim, eid, "income", m, sim.end, annual / D(12), None, g, 4)
        except Unresolved:
            continue
    # 終了指定: 発生月の前月で止める
    for e in evs:
        m = sim.event_month[e["id"]]
        for target in e["endsIds"]:
            for f in sim.flows + sim.transfers:
                if f["src"] == target:
                    f["to"] = min(f["to"], m - 1)
            # 定期的な一時金（更新料）も発生月以降は計上しない
            for (o, src) in list(sim.endable):
                if src == target and o[0] >= m and o in sim.onetimes:
                    sim.onetimes.remove(o)


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
