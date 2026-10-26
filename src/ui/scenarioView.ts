// 画面表示用の補助（シナリオから選択肢などを作る）。計算は行わない。

import type { Account, FlowItem, Scenario } from '../domain/schema';
import type { MemberOption } from './components/TriggerField';

const ROLE: Record<string, string> = { self: '本人', spouse: '配偶者', child: '子' };

/** 選択肢にするメンバー（登録メンバー + 結婚・出産イベントで追加されるメンバー） */
export function memberOptions(s: Scenario): MemberOption[] {
  const base = s.members.map((m) => ({ id: m.id, label: `${m.name}（${ROLE[m.role]}）` }));
  const derived: MemberOption[] = [];
  for (const e of s.events) {
    if (e.type === 'marriage') derived.push({ id: `${e.id}:spouse`, label: `${e.params.spouseName}（結婚イベント「${e.name}」で追加）` });
    if (e.type === 'birth') derived.push({ id: `${e.id}:child`, label: `${e.params.childName}（出産イベント「${e.name}」で追加）` });
  }
  return [...base, ...derived];
}

export function childOptions(s: Scenario): MemberOption[] {
  return memberOptions(s).filter((o) => {
    const m = s.members.find((x) => x.id === o.id);
    return m ? m.role === 'child' : o.id.endsWith(':child');
  });
}

/** 月額換算（成長率は考慮しない入力値ベース） */
export function monthlyEquivalent(f: Pick<FlowItem, 'amount' | 'frequency' | 'months'>): number {
  if (f.frequency === 'monthly') return f.amount;
  return (f.amount * (f.months?.length ?? 0)) / 12;
}

export const ACCOUNT_KIND_LABEL: Record<Account['kind'], string> = {
  cash: '生活口座（現金・普通預金）',
  savings: '預金（定期等）',
  investment: '投資',
  property: '不動産',
  vehicle: '車両',
  other_asset: 'その他資産',
  loan: '負債（ローン）',
};

export const RATE_LABEL: Record<Account['kind'], string> = {
  cash: '金利（年率）',
  savings: '金利（年率・税引後）',
  investment: '期待利回り（年率・税引後）',
  property: '評価額の変動率（年率）',
  vehicle: '評価額の変動率（年率）',
  other_asset: '変動率（年率）',
  loan: 'ローン金利（年率）',
};
