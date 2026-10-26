// イベント入力の検証（スキーマ + 項目間）
import { lifeEventSchema, type LifeEvent, type Scenario } from '../../domain/schema';
import { collectErrors } from '../components/common';
import { birthsOf, periodOrder } from '../validators';

export function validateEvent(e: LifeEvent, s: Scenario): Record<string, string> {
  const errors = collectErrors(lifeEventSchema, e);
  if (!e.name.trim()) errors.name = '名称を入力してください';
  const births = birthsOf(s);
  const needMember = (id: string, key: string, label: string) => {
    if (!id) errors[key] = `${label}を選んでください`;
    else if (!births.has(id)) errors[key] = `${label}が見つかりません`;
  };
  if (e.trigger.type !== 'date') needMember(e.trigger.memberId, 'trigger', '対象者');
  const p = e.params as Record<string, unknown>;
  if (Array.isArray(p.flows)) {
    (e.params as { flows: { name: string; frequency: string; months?: number[]; end: LifeEvent['trigger'] | null }[] }).flows.forEach((f, i) => {
      if (!f.name.trim()) errors[`params.flows.${i}.name`] = '名称を入力してください';
      if (f.frequency === 'months' && !f.months?.length) errors[`params.flows.${i}.months`] = '発生月を 1 つ以上選んでください';
      const d = periodOrder(e.trigger, f.end, s);
      if (d) errors[`params.flows.${i}.end`] = d;
    });
  }
  switch (e.type) {
    case 'home_purchase':
      if (Number.isFinite(e.params.price) && Number.isFinite(e.params.downPayment) && e.params.downPayment > e.params.price) {
        errors['params.downPayment'] = '頭金は物件価格以下にしてください';
      }
      break;
    case 'car':
      if (e.params.loan && Number.isFinite(e.params.price) && e.params.downPayment > e.params.price) errors['params.downPayment'] = '頭金は車両価格以下にしてください';
      if (e.params.holdUntil) {
        const d = periodOrder(e.trigger, e.params.holdUntil, s);
        if (d) errors['params.holdUntil'] = '手放す時期は購入より後にしてください';
      }
      break;
    case 'education':
      needMember(e.params.memberId, 'params.memberId', '対象の子');
      break;
    case 'pension':
      needMember(e.params.memberId, 'params.memberId', '受給者');
      break;
    case 'rent': {
      const d = periodOrder(e.trigger, e.params.end, s);
      if (d) errors['params.end'] = d;
      break;
    }
    case 'marriage':
      if (s.members.some((m) => m.role === 'spouse')) errors['params.spouseName'] = '配偶者がすでに登録されています（プロフィールの配偶者を削除するか、このイベントを使わないでください）';
      break;
  }
  return errors;
}
