// トリガー解決（calculation-spec §2.4〜2.6）

import type { Trigger } from '../domain/schema';
import { calendarMonthOf, parseYm, stageEntry, type MonthIndex } from '../domain/time';

export type Births = Map<string, MonthIndex>;

export class UnresolvedMemberError extends Error {
  constructor(readonly memberId: string) {
    super(`メンバー ${memberId} が見つかりません`);
  }
}

function birthOf(births: Births, id: string): MonthIndex {
  const b = births.get(id);
  if (b === undefined) throw new UnresolvedMemberError(id);
  return b;
}

/** age 歳である期間中の指定月（calendar month） */
function monthWithinAge(birth: MonthIndex, age: number, month: number): MonthIndex {
  const first = birth + age * 12;
  for (let k = first; k < first + 12; k++) if (calendarMonthOf(k) === month) return k;
  /* c8 ignore next */
  throw new Error('unreachable');
}

/** 開始・発生時点として解決する（その月から） */
export function resolveStart(t: Trigger, births: Births): MonthIndex {
  switch (t.type) {
    case 'date':
      return parseYm(t.ym);
    case 'age': {
      const b = birthOf(births, t.memberId);
      return t.month ? monthWithinAge(b, t.age, t.month) : b + t.age * 12;
    }
    case 'school':
      return stageEntry(birthOf(births, t.memberId), t.stage);
  }
}

/**
 * 終了時点として解決する（その月まで含む）。
 * - date: その月まで
 * - age: endMode=before（既定）は age 歳になる前月まで、through は age 歳の最終月まで。month 指定時はその月まで
 * - school: その段階の入学月の前月（3 月）まで
 */
export function resolveEnd(t: Trigger, births: Births): MonthIndex {
  switch (t.type) {
    case 'date':
      return parseYm(t.ym);
    case 'age': {
      const b = birthOf(births, t.memberId);
      if (t.month) return monthWithinAge(b, t.age, t.month);
      return t.endMode === 'through' ? b + (t.age + 1) * 12 - 1 : b + t.age * 12 - 1;
    }
    case 'school':
      return stageEntry(birthOf(births, t.memberId), t.stage) - 1;
  }
}
