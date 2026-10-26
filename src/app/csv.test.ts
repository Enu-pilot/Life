import { describe, expect, it } from 'vitest';
import { flow, scenario } from '../../tests/unit/fixtures';
import { simulate } from '../engine';
import { buildYearlyCsv, csvCell } from './csv';

describe('CSV 出力', () => {
  it('セルのエスケープ（カンマ・引用符・改行、数式インジェクション対策）', () => {
    expect(csvCell(-1234)).toBe('-1234');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('普通の文字')).toBe('普通の文字');
  });
  it('BOM 付き・CRLF、年次表の行数と値が結果と一致', () => {
    const s = scenario({ name: '計画,A', assumptions: { ...scenario().assumptions, endAge: 40 }, flows: [flow({ id: 'in', amount: 300000 })] });
    const r = simulate(s);
    if (!r.ok) throw new Error();
    const csv = buildYearlyCsv(s, r, { real: false, exportedAt: new Date('2026-10-26T00:00:00Z') });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('シナリオ,"計画,A"');
    const header = lines.findIndex((l) => l.startsWith('年,'));
    expect(lines.length - header - 1).toBe(r.yearly.length);
    const first = lines[header + 1]!.split(',');
    expect(Number(first[0])).toBe(2027);
    expect(Number(first[2])).toBe(r.yearly[0]!.income);
    expect(Number(first[15])).toBe(r.yearly[0]!.netWorth);
  });
});
