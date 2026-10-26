import type { Trigger } from '../../domain/schema';
import { IntField, SelectField, YmField } from './fields';

export type MemberOption = { id: string; label: string };

const STAGE_OPTIONS = [
  { value: 'kindergarten', label: '幼稚園入園（3年保育）' },
  { value: 'elementary', label: '小学校入学' },
  { value: 'junior', label: '中学校入学' },
  { value: 'high', label: '高校入学' },
  { value: 'university', label: '大学入学' },
] as const;

/**
 * 発生時期・開始・終了の指定（calculation-spec §2.4）。
 * mode=end の場合、年齢指定は「X 歳になる前月まで / X 歳の間も含む」を選択させる（Q-04）。
 */
export function TriggerField({
  label,
  value,
  onChange,
  members,
  nullLabel,
  mode,
  error,
  defaultYm,
}: {
  label: string;
  value: Trigger | null;
  onChange: (t: Trigger | null) => void;
  members: MemberOption[];
  /** null を許す場合のラベル（例: 「シミュレーション開始から」「終了まで続く」） */
  nullLabel?: string;
  mode: 'start' | 'end' | 'point';
  error?: string | undefined;
  defaultYm: string;
}) {
  const type = value?.type ?? 'null';
  const firstMember = members[0]?.id ?? '';
  const typeOptions = [
    ...(nullLabel ? [{ value: 'null', label: nullLabel }] : []),
    { value: 'date', label: '年月で指定' },
    { value: 'age', label: '年齢で指定' },
    { value: 'school', label: '学齢で指定（子）' },
  ] as { value: string; label: string }[];

  const setType = (t: string) => {
    if (t === 'null') onChange(null);
    else if (t === 'date') onChange({ type: 'date', ym: defaultYm });
    else if (t === 'age') onChange({ type: 'age', memberId: firstMember, age: 65, ...(mode === 'end' ? { endMode: 'before' as const } : {}) });
    else onChange({ type: 'school', memberId: firstMember, stage: 'elementary' });
  };

  return (
    <fieldset className={`field trigger${error ? ' field--error' : ''}`}>
      <legend>{label}</legend>
      <SelectField label="指定方法" value={type} onChange={setType} options={typeOptions} />
      {value?.type === 'date' && (
        <YmField
          label={mode === 'end' ? '終了年月（この月を含む）' : '年月'}
          value={value.ym}
          onChange={(ym) => onChange({ type: 'date', ym })}
        />
      )}
      {value?.type === 'age' && (
        <>
          <SelectField
            label="対象者"
            value={value.memberId}
            onChange={(memberId) => onChange({ ...value, memberId })}
            options={members.map((m) => ({ value: m.id, label: m.label }))}
          />
          <IntField label="年齢" unit="歳" value={value.age} onChange={(age) => onChange({ ...value, age })} />
          <SelectField
            label="月"
            value={value.month ? String(value.month) : 'birth'}
            onChange={(v) => {
              const { month: _m, ...rest } = value;
              void _m;
              onChange(v === 'birth' ? rest : { ...rest, month: Number(v) });
            }}
            options={[
              { value: 'birth', label: mode === 'end' ? '誕生月基準' : 'その年齢になる誕生月' },
              ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${value.age}歳の間の${i + 1}月` })),
            ]}
          />
          {mode === 'end' && !value.month && (
            <SelectField
              label="終了の解釈"
              value={value.endMode ?? 'before'}
              onChange={(endMode) => onChange({ ...value, endMode })}
              options={[
                { value: 'before', label: `${value.age}歳になる前月まで（${value.age}歳未満の間）` },
                { value: 'through', label: `${value.age}歳の間も含む（${value.age + 1}歳になる前月まで）` },
              ]}
            />
          )}
        </>
      )}
      {value?.type === 'school' && (
        <>
          <SelectField
            label="対象の子"
            value={value.memberId}
            onChange={(memberId) => onChange({ ...value, memberId })}
            options={members.map((m) => ({ value: m.id, label: m.label }))}
          />
          <SelectField label="時期" value={value.stage} onChange={(stage) => onChange({ ...value, stage })} options={STAGE_OPTIONS} />
          {mode === 'end' && <div className="field__hint">この時期の前月（3月）までで終了します</div>}
        </>
      )}
      {(value?.type === 'age' || value?.type === 'school') && members.length === 0 && (
        <div className="field__error">対象者が登録されていません。プロフィールで登録してください。</div>
      )}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </fieldset>
  );
}
