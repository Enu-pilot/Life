import { formatYmJa } from '../domain/format';
import type { Trigger } from '../domain/schema';
import type { MemberOption } from './components/TriggerField';

const STAGE: Record<string, string> = {
  kindergarten: '幼稚園入園',
  elementary: '小学校入学',
  junior: '中学校入学',
  high: '高校入学',
  university: '大学入学',
};

function shortName(label: string): string {
  return label.replace(/（.*）$/, '');
}

/** トリガーを日本語で説明する（一覧表示用） */
export function describeTrigger(t: Trigger, members: MemberOption[], isEnd = false): string {
  const who = 'memberId' in t ? shortName(members.find((m) => m.id === t.memberId)?.label ?? '（不明なメンバー）') : '';
  switch (t.type) {
    case 'date':
      return formatYmJa(t.ym);
    case 'age': {
      if (t.month) return `${who} ${t.age}歳の${t.month}月`;
      if (!isEnd) return `${who} ${t.age}歳`;
      return t.endMode === 'through' ? `${who} ${t.age}歳の間まで` : `${who} ${t.age}歳になる前月まで`;
    }
    case 'school':
      return isEnd ? `${who} ${STAGE[t.stage]}の前月まで` : `${who} ${STAGE[t.stage]}`;
  }
}
