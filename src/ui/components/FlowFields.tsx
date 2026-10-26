import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../domain/categories';
import type { FlowTemplate, Growth, Trigger } from '../../domain/schema';
import { MonthsField, PercentField, SelectField, TextField, YenField } from './fields';
import { TriggerField, type MemberOption } from './TriggerField';

/** FlowItem / FlowTemplate 共通の入力項目（id・key・start を除く） */
export type FlowCore = Omit<FlowTemplate, 'key'>;

export function defaultStepMonth(category: string): number {
  return category === 'salary' || category === 'bonus' ? 4 : 1;
}

export function FlowFields({
  value,
  onChange,
  errors,
  members,
  defaultYm,
  startSlot,
}: {
  value: FlowCore;
  onChange: (v: FlowCore) => void;
  errors: Record<string, string>;
  members: MemberOption[];
  defaultYm: string;
  /** 開始時期の入力欄（FlowItem のみ） */
  startSlot?: React.ReactNode;
}) {
  const v = value;
  const cats = v.direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const catOptions = Object.entries(cats)
    .filter(([k]) => k !== 'loan_interest')
    .map(([k, label]) => ({ value: k, label }));
  const setGrowth = (g: Growth) => onChange({ ...v, growth: g });
  return (
    <>
      <div className="grid2">
        <TextField label="名称" required value={v.name} onChange={(name) => onChange({ ...v, name })} error={errors.name} maxLength={40} />
        <SelectField
          label="カテゴリ"
          value={v.category}
          onChange={(category) => onChange({ ...v, category, growthStepMonth: defaultStepMonth(category) })}
          options={catOptions}
          error={errors.category}
        />
        <YenField
          label={v.frequency === 'monthly' ? '金額（1か月あたり）' : '金額（1回あたり）'}
          required
          value={v.amount}
          onChange={(amount) => onChange({ ...v, amount })}
          error={errors.amount}
          hint={v.direction === 'income' ? '手取り額で入力してください（税・社会保険料は計算しません）' : undefined}
        />
        <SelectField
          label="対象者（任意）"
          value={v.ownerId ?? ''}
          onChange={(o) => {
            const { ownerId: _o, ...rest } = v;
            void _o;
            onChange(o ? { ...rest, ownerId: o } : rest);
          }}
          options={[{ value: '', label: '指定なし（世帯）' }, ...members.map((m) => ({ value: m.id, label: m.label }))]}
        />
        <SelectField
          label="頻度"
          value={v.frequency}
          onChange={(frequency) => onChange({ ...v, frequency, months: frequency === 'months' ? (v.months?.length ? v.months : [12]) : undefined })}
          options={[
            { value: 'monthly', label: '毎月' },
            { value: 'months', label: '毎年、指定した月（賞与・年払い等）' },
          ]}
        />
      </div>
      {v.frequency === 'months' && <MonthsField label="発生月" value={v.months ?? []} onChange={(months) => onChange({ ...v, months })} error={errors.months} />}
      <div className="grid2">
        {startSlot}
        <TriggerField
          label="終了"
          mode="end"
          value={v.end}
          onChange={(end: Trigger | null) => onChange({ ...v, end })}
          members={members}
          nullLabel="終了しない（計算終了まで）"
          error={errors.end}
          defaultYm={defaultYm}
        />
      </div>
      <fieldset className="field">
        <legend>金額の変化</legend>
        <div className="grid2">
          <SelectField
            label="上昇率"
            value={v.growth.type}
            onChange={(t) => setGrowth(t === 'fixed' ? { type: 'fixed', rate: 0.01 } : { type: t })}
            options={[
              { value: 'none', label: '変化なし' },
              { value: 'inflation', label: '物価上昇率に連動' },
              { value: 'fixed', label: '固定の率（昇給率など）' },
            ]}
          />
          {v.growth.type === 'fixed' && (
            <PercentField label="年率" value={v.growth.rate} onChange={(rate) => setGrowth({ type: 'fixed', rate })} error={errors['growth.rate']} />
          )}
          {v.growth.type !== 'none' && (
            <>
              <SelectField
                label="入力した金額の時点"
                value={v.growthBase}
                onChange={(growthBase) => onChange({ ...v, growthBase })}
                options={[
                  { value: 'start', label: 'シミュレーション開始時点の価格' },
                  { value: 'itemStart', label: 'この項目の開始時点の価格' },
                ]}
              />
              <SelectField
                label="上昇を適用する月"
                value={String(v.growthStepMonth)}
                onChange={(m) => onChange({ ...v, growthStepMonth: Number(m) })}
                options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `毎年${i + 1}月` }))}
              />
            </>
          )}
        </div>
      </fieldset>
    </>
  );
}

export function emptyFlowCore(direction: 'income' | 'expense'): FlowCore {
  const category = direction === 'income' ? 'salary' : 'living';
  return {
    direction,
    name: '',
    category,
    amount: NaN,
    frequency: 'monthly',
    end: null,
    growth: { type: 'none' },
    growthBase: 'start',
    growthStepMonth: defaultStepMonth(category),
  };
}
