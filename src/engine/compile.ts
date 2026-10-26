// シナリオ（保存データ）→ 計算ルール（Plan）への変換と検証（calculation-spec §6, §14）

import { categoryLabel } from '../domain/categories';
import type { FlowTemplate, LifeEvent, Scenario, Trigger } from '../domain/schema';
import { ageAt, formatYm, parseYm, type MonthIndex } from '../domain/time';
import { derivedMembers, EXPANDERS, type ExpandApi } from './events/registry';
import { resolveEnd, resolveStart, UnresolvedMemberError } from './triggers';
import type { AccountC, Ctx, FlowRule, Issue, LoanRule, OneTime, Plan, ResolvedEvent, SimOptions, TransferRuleC } from './types';

const TRANSFERABLE = new Set(['cash', 'savings', 'investment', 'other_asset']);

export function compile(s: Scenario, opts: SimOptions = {}): { plan: Plan | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (code: string, message: string, refId?: string) => issues.push({ level: 'error', code, message, ...(refId ? { refId } : {}) });
  const warn = (code: string, message: string, refId?: string) => issues.push({ level: 'warning', code, message, ...(refId ? { refId } : {}) });

  // ---- 構造の検証 ----
  const ids = new Set<string>();
  for (const x of [...s.members, ...s.accounts, ...s.flows, ...s.transfers, ...s.events]) {
    if (ids.has(x.id)) err('DUPLICATE_ID', `ID が重複しています: ${x.id}`, x.id);
    ids.add(x.id);
  }
  const self = s.members.find((m) => m.role === 'self');
  if (!self) err('NO_SELF', '本人の生年月が登録されていません。プロフィールで本人を登録してください。');
  if (s.members.filter((m) => m.role === 'self').length > 1) err('MULTIPLE_SELF', '本人が複数登録されています');
  const cashAccounts = s.accounts.filter((a) => a.kind === 'cash');
  if (cashAccounts.length !== 1) err('CASH_ACCOUNT', '生活口座はちょうど 1 つ必要です');
  for (const a of s.accounts) if (a.kind === 'loan' && !a.loan) err('LOAN_TERMS', `負債「${a.name}」に返済条件がありません`, a.id);

  const start = parseYm(s.assumptions.startYm);
  let end = start;
  if (self) {
    const sb = parseYm(self.birthYm);
    if (sb > start) err('SELF_BIRTH', '本人の生年月がシミュレーション開始年月より後です', self.id);
    end = sb + s.assumptions.endAge * 12; // 本人が endAge 歳に到達する月まで（§2.2）
    if (ageAt(sb, start) >= s.assumptions.endAge) err('END_AGE', '終了年齢が開始時点の本人の年齢以下です');
  }
  if (issues.some((i) => i.level === 'error')) return { plan: null, issues };

  const ctx: Ctx = { start, end, inflationRate: s.assumptions.inflationRate + (opts.inflationShift ?? 0), births: new Map() };
  for (const m of s.members) ctx.births.set(m.id, parseYm(m.birthYm));

  // ---- イベントの発生月と派生メンバー（参照の依存を順に解決） ----
  const enabledEvents = s.events.filter((e) => e.enabled);
  const eventMonths = new Map<string, MonthIndex>();
  const resolvedEvents: ResolvedEvent[] = [];
  let pending = [...enabledEvents];
  for (let pass = 0; pass < s.events.length + 1 && pending.length > 0; pass++) {
    const next: LifeEvent[] = [];
    for (const e of pending) {
      try {
        const month = resolveStart(e.trigger, ctx.births);
        eventMonths.set(e.id, month);
        for (const d of derivedMembers(e, () => month, parseYm)) ctx.births.set(d.id, d.birth);
      } catch (x) {
        if (x instanceof UnresolvedMemberError) next.push(e);
        else throw x;
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  for (const e of pending) {
    warn('EVENT_UNRESOLVED', `イベント「${e.name}」の対象者が見つからない（または無効なイベントで追加されるメンバーを参照している）ため、計算に含めません`, e.id);
  }

  const accounts: AccountC[] = s.accounts.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    opening: a.openingBalance,
    annualRate: a.annualRate,
    sourceId: a.id,
    sourceKind: 'account',
  }));

  const tryResolve = <T>(fn: () => T, what: string, refId: string): T | null => {
    try {
      return fn();
    } catch (x) {
      if (x instanceof UnresolvedMemberError) {
        warn('MEMBER_UNRESOLVED', `${what}の対象者が見つからない（または無効なイベントで追加されるメンバーを参照している）ため、計算に含めません`, refId);
        return null;
      }
      throw x;
    }
  };

  const growthBaseOf = (base: 'start' | 'itemStart', from: MonthIndex) => (base === 'start' ? start : from);

  // ---- 基本の収支項目 ----
  const flows: FlowRule[] = [];
  for (const f of s.flows) {
    const r = tryResolve(
      () => ({ from: f.start ? resolveStart(f.start, ctx.births) : start, to: f.end ? resolveEnd(f.end, ctx.births) : end }),
      `収支「${f.name}」`,
      f.id,
    );
    if (!r) continue;
    if (f.frequency === 'months' && (!f.months || f.months.length === 0)) {
      warn('NO_MONTHS', `収支「${f.name}」の発生月が指定されていないため計上されません`, f.id);
    }
    flows.push({
      key: f.id,
      sourceId: f.id,
      sourceKind: 'item',
      name: f.name,
      direction: f.direction,
      category: f.category,
      from: r.from,
      to: r.to,
      amount: f.amount,
      months: f.frequency === 'monthly' ? null : (f.months ?? []),
      growth: f.growth,
      growthBase: growthBaseOf(f.growthBase, r.from),
      growthStepMonth: f.growthStepMonth,
    });
  }

  // ---- 積立・取崩 ----
  const transfers: TransferRuleC[] = [];
  for (const t of s.transfers) {
    const fromA = s.accounts.find((a) => a.id === t.fromId);
    const toA = s.accounts.find((a) => a.id === t.toId);
    if (!fromA || !toA || !TRANSFERABLE.has(fromA.kind) || !TRANSFERABLE.has(toA.kind) || t.fromId === t.toId) {
      err('TRANSFER_ACCOUNT', `積立・取崩「${t.name}」の口座指定が不正です`, t.id);
      continue;
    }
    const r = tryResolve(
      () => ({ from: t.start ? resolveStart(t.start, ctx.births) : start, to: t.end ? resolveEnd(t.end, ctx.births) : end }),
      `積立・取崩「${t.name}」`,
      t.id,
    );
    if (!r) continue;
    transfers.push({
      key: t.id,
      sourceId: t.id,
      sourceKind: 'item',
      name: t.name,
      fromId: t.fromId,
      toId: t.toId,
      from: r.from,
      to: r.to,
      amount: t.amount,
      months: t.frequency === 'monthly' ? null : (t.months ?? []),
      growth: t.growth,
      growthBase: growthBaseOf(t.growthBase, r.from),
      growthStepMonth: t.growthStepMonth,
    });
  }

  // ---- 既存の負債 ----
  const loans: LoanRule[] = [];
  for (const a of s.accounts) {
    if (a.kind !== 'loan' || !a.loan) continue;
    loans.push({
      accountId: a.id,
      name: a.name,
      sourceId: a.id,
      sourceKind: 'account',
      firstPayment: start,
      termMonths: a.loan.remainingMonths,
      method: a.loan.method,
      annualRate: a.annualRate,
      rateChanges: [],
    });
  }

  // ---- 人生イベントの展開 ----
  const oneTimes: OneTime[] = [];
  const sorted = [...enabledEvents]
    .filter((e) => eventMonths.has(e.id))
    .sort((a, b) => eventMonths.get(a.id)! - eventMonths.get(b.id)! || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const expandedIds = new Set<string>();
  for (const e of sorted) {
    if (expandedIds.has(e.id)) throw new Error(`イベントが二重に展開されました: ${e.id}`);
    expandedIds.add(e.id);
    const month = eventMonths.get(e.id)!;
    const re: ResolvedEvent = { id: e.id, name: e.name, type: e.type, month, enabled: true };
    resolvedEvents.push(re);
    if (month > end) {
      re.skipped = 'シミュレーション期間の後';
      warn('EVENT_OUT_OF_RANGE', `イベント「${e.name}」（${formatYm(month)}）はシミュレーション期間外のため計算に含めません`, e.id);
      continue;
    }
    if (month < start) {
      warn('EVENT_BEFORE_START', `イベント「${e.name}」（${formatYm(month)}）は開始年月より前です。開始前の部分は計算に含めません`, e.id);
    }
    const expander = EXPANDERS[e.type] as ((e: LifeEvent, api: ExpandApi) => void) | undefined;
    if (!expander) {
      re.skipped = '未対応の種別';
      warn('EVENT_UNSUPPORTED', `イベント種別「${e.type}」は未対応のため計算に含めません`, e.id);
      continue;
    }
    const src = { sourceId: e.id, sourceKind: 'event' as const };
    const api: ExpandApi = {
      ctx,
      month,
      resolveStart: (t: Trigger) => resolveStart(t, ctx.births),
      resolveEnd: (t: Trigger) => resolveEnd(t, ctx.births),
      addTemplate: (t: FlowTemplate) => {
        const to = t.end ? resolveEnd(t.end, ctx.births) : end;
        flows.push({
          key: `${e.id}:${t.key}`,
          ...src,
          name: t.name || e.name,
          direction: t.direction,
          category: t.category,
          from: month,
          to,
          amount: t.amount,
          months: t.frequency === 'monthly' ? null : (t.months ?? []),
          growth: t.growth,
          growthBase: growthBaseOf(t.growthBase, month),
          growthStepMonth: t.growthStepMonth,
        });
      },
      addFlow: (r) => flows.push({ ...r, ...src, key: `${e.id}:${r.key}` }),
      addOneTime: (o) => oneTimes.push({ ...o, ...src, key: `${e.id}:${o.key}` } as OneTime),
      addAccount: (a) => accounts.push({ ...a, ...src }),
      addLoan: (l) => loans.push({ ...l, ...src }),
      warn: (code, message) => warn(code, `イベント「${e.name}」: ${message}`, e.id),
    };
    try {
      expander(e, api);
    } catch (x) {
      if (x instanceof UnresolvedMemberError) {
        re.skipped = '対象者が見つからない';
        warn('MEMBER_UNRESOLVED', `イベント「${e.name}」の対象者が見つからないため計算に含めません`, e.id);
      } else throw x;
    }
  }
  for (const e of s.events) {
    if (!e.enabled) {
      let month: MonthIndex | null = null;
      try {
        month = resolveStart(e.trigger, ctx.births);
      } catch {
        month = null;
      }
      if (month !== null) resolvedEvents.push({ id: e.id, name: e.name, type: e.type, month, enabled: false, skipped: '無効' });
    }
  }
  resolvedEvents.sort((a, b) => a.month - b.month);

  // ---- 終了指定（endsIds）: 指定された収支・積立をイベント発生月の前月で止める ----
  for (const e of sorted) {
    const month = eventMonths.get(e.id)!;
    for (const target of e.endsIds) {
      let hit = false;
      for (const f of [...flows, ...transfers]) {
        if (f.sourceId === target) {
          f.to = Math.min(f.to, month - 1);
          hit = true;
        }
      }
      if (!hit && !s.events.some((x) => x.id === target)) {
        warn('ENDS_UNRESOLVED', `イベント「${e.name}」で終了させる項目が見つかりません`, e.id);
      }
    }
  }

  // ---- 警告: 期間・住居費の重複 ----
  for (const f of flows) {
    if (f.to < f.from && f.sourceKind === 'item') warn('EMPTY_PERIOD', `収支「${f.name}」の終了が開始より前のため計上されません`, f.sourceId);
    else if (f.from > end && f.sourceKind === 'item') warn('OUT_OF_RANGE', `収支「${f.name}」の開始がシミュレーション期間の後です`, f.sourceId);
  }
  const rents = flows.filter((f) => f.category === 'rent' && f.direction === 'expense' && f.to >= f.from);
  for (let i = 0; i < rents.length; i++) {
    for (let j = i + 1; j < rents.length; j++) {
      const a = rents[i]!;
      const b = rents[j]!;
      if (a.sourceId !== b.sourceId && a.from <= b.to && b.from <= a.to) {
        warn(
          'RENT_OVERLAP',
          `${categoryLabel('rent')}「${a.name}」と「${b.name}」が ${formatYm(Math.max(a.from, b.from))} から重複しています。引っ越しや住宅購入で終了させる項目を指定してください`,
          b.sourceId,
        );
      }
    }
  }
  if (s.flows.length === 0 && s.events.length === 0) {
    warn('NO_FLOWS', '収入・支出が登録されていません。結果は初期資産の運用のみを反映した参考値です');
  }
  return {
    plan: { ctx, accounts, flows, transfers, oneTimes, loans, events: resolvedEvents, autoLiquidate: s.assumptions.autoLiquidate },
    issues,
  };
}
