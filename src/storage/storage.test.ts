import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as idb from 'idb-keyval';
import { appData, flow, scenario } from '../../tests/unit/fixtures';
import { duplicateScenario } from '../domain/factory';
import { parseAppData } from '../domain/schema';
import { buildBackupFile, parseBackupFile } from './backupFile';
import { migrate } from './migrations';
import { MAX_BACKUPS, Repository } from './repository';

let dbSeq = 0;
const freshRepo = () => new Repository(`test-${++dbSeq}`, 'kv');


describe('スキーマ検証', () => {
  it('正しいデータは通る', () => {
    expect(parseAppData(appData()).ok).toBe(true);
  });
  it.each([
    ['金額が負', (d: any) => (d.scenarios[0].accounts[0].openingBalance = -1)],
    ['金額が小数', (d: any) => (d.scenarios[0].accounts[0].openingBalance = 1.5)],
    ['金額が文字列', (d: any) => (d.scenarios[0].accounts[0].openingBalance = '100')],
    ['金額が上限超過', (d: any) => (d.scenarios[0].accounts[0].openingBalance = 100_000_000_001)],
    ['率が範囲外', (d: any) => (d.scenarios[0].assumptions.inflationRate = 0.51)],
    ['年月の形式不正', (d: any) => (d.scenarios[0].members[0].birthYm = '1990-13')],
    ['終了年齢が範囲外', (d: any) => (d.scenarios[0].assumptions.endAge = 111)],
    ['必須欠落', (d: any) => delete d.scenarios[0].assumptions],
    ['シナリオ 0 件', (d: any) => (d.scenarios = [])],
    ['active が存在しない', (d: any) => (d.activeScenarioId = 'nope')],
    ['NaN', (d: any) => (d.scenarios[0].accounts[0].annualRate = NaN)],
  ])('%s は拒否', (_n, mutate) => {
    const d = structuredClone(appData());
    mutate(d);
    expect(parseAppData(d).ok).toBe(false);
  });
  it('未知のフィールドは除去される', () => {
    const d: any = structuredClone(appData());
    d.unknownField = 1;
    d.scenarios[0].evil = '<script>';
    const r = parseAppData(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('unknownField' in r.data).toBe(false);
      expect('evil' in r.data.scenarios[0]!).toBe(false);
    }
  });
});

describe('マイグレーション', () => {
  it('現行版はそのまま', () => {
    const r = migrate(appData());
    expect(r.ok && r.fromVersion).toBe(1);
  });
  it.each([
    [null, 'format'],
    [[], 'format'],
    ['str', 'format'],
    [{ app: 'other', schemaVersion: 1 }, 'app'],
    [{ app: 'lifeplan' }, 'version'],
    [{ app: 'lifeplan', schemaVersion: 0 }, 'version'],
    [{ app: 'lifeplan', schemaVersion: 1.5 }, 'version'],
    [{ app: 'lifeplan', schemaVersion: 99 }, 'version'],
    [{ app: 'lifeplan', schemaVersion: 1, scenarios: 'x' }, 'schema'],
  ])('%j は %s 段階で拒否', (raw, stage) => {
    const r = migrate(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe(stage);
  });
  it('逐次マイグレーションを順に適用し、元のオブジェクトは変更しない（枠組みの検証）', () => {
    const v1: any = structuredClone(appData());
    const original = structuredClone(v1);
    const order: number[] = [];
    const steps = {
      1: (d: any) => (order.push(1), { ...d, schemaVersion: 2, a: true }),
      2: (d: any) => (order.push(2), { ...d, schemaVersion: 3, b: d.a === true }),
    };
    let seen: any;
    const r = migrate(v1, steps, 3, (x) => ((seen = x), { ok: true, data: x as any }));
    expect(r.ok && r.fromVersion).toBe(1);
    expect(order).toEqual([1, 2]);
    expect(seen.schemaVersion).toBe(3);
    expect(seen.b).toBe(true);
    expect(v1).toEqual(original);
  });
  it('移行結果のバージョンが不正なら拒否', () => {
    const r = migrate(appData(), { 1: (d) => d }, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
  it('移行関数が例外を投げたら migration 段階で拒否', () => {
    const r = migrate(appData(), { 1: () => { throw new Error('boom'); } }, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
  it('移行関数がない場合は拒否', () => {
    const r = migrate(appData(), {}, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
});

describe('Repository（IndexedDB）', () => {
  it('空の場合は empty', async () => {
    expect((await freshRepo().load()).status).toBe('empty');
  });
  it('保存 → 読み込みで等価', async () => {
    const repo = freshRepo();
    const d = appData([scenario({ flows: [flow({ id: 'f1', amount: 300000 })] })]);
    await repo.save(d);
    const r = await repo.load();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.data).toEqual(d);
  });
  it('別インスタンス（再読み込み相当）でも保持される', async () => {
    const name = `persist-${++dbSeq}`;
    await new Repository(name).save(appData());
    const r = await new Repository(name).load();
    expect(r.status).toBe('ok');
  });
  it('破損データは corrupt として返し、データを消さない', async () => {
    const name = `corrupt-${++dbSeq}`;
    const store = idb.createStore(name, 'kv');
    await idb.set('data', { app: 'lifeplan', schemaVersion: 1, scenarios: 'broken' }, store);
    const repo = new Repository(name);
    const r = await repo.load();
    expect(r.status).toBe('corrupt');
    expect(await idb.get('data', store)).toEqual({ app: 'lifeplan', schemaVersion: 1, scenarios: 'broken' });
  });
  it('replace は置換前のデータを退避する', async () => {
    const repo = freshRepo();
    const a = appData([scenario({ name: 'A' })]);
    const b = appData([scenario({ name: 'B' })]);
    await repo.save(a);
    await repo.replace(b, 'import');
    const r = await repo.load();
    expect(r.status === 'ok' && r.data.scenarios[0]!.name).toBe('B');
    const backups = await repo.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]!.reason).toBe('import');
    expect((backups[0]!.data as any).scenarios[0].name).toBe('A');
  });
  it(`退避は最大 ${MAX_BACKUPS} 世代`, async () => {
    const repo = freshRepo();
    for (let i = 0; i < 8; i++) await repo.pushBackup('daily', { i });
    const list = await repo.listBackups();
    expect(list).toHaveLength(MAX_BACKUPS);
    expect((list[0]!.data as any).i).toBe(7);
  });
  it('replace の書き込み失敗時は元データを書き戻して例外', async () => {
    const base = freshRepo();
    await base.save(appData([scenario({ name: 'A' })]));
    let calls = 0;
    const failing = new Repository({
      get: (k) => base.kv.get(k),
      del: (k) => base.kv.del(k),
      set: async (k, v) => {
        calls++;
        // 1 回目: 退避（成功）、2 回目: 新データの書き込み（失敗）、3 回目: 書き戻し（成功）
        if (calls === 2) throw new Error('QuotaExceededError');
        await base.kv.set(k, v);
      },
    });
    await expect(failing.replace(appData([scenario({ name: 'B' })]), 'import')).rejects.toThrow('QuotaExceededError');
    const r = await base.load();
    expect(r.status === 'ok' && r.data.scenarios[0]!.name).toBe('A');
  });
});

describe('シナリオ複製', () => {
  it('全 ID を振り直し、参照も追従する。元シナリオは不変', () => {
    const src = scenario({
      flows: [flow({ id: 'f1', amount: 1, ownerId: 'self', end: { type: 'age', memberId: 'self', age: 60, endMode: 'before' } })],
      events: [
        {
          id: 'ev1',
          type: 'birth',
          name: '第一子',
          enabled: true,
          trigger: { type: 'date', ym: '2028-04' },
          endsIds: ['f1'],
          params: { childName: '子', cost: 0, flows: [] },
        },
        {
          id: 'ev2',
          type: 'education',
          name: '教育',
          enabled: true,
          trigger: { type: 'school', memberId: 'ev1:child', stage: 'kindergarten' },
          endsIds: [],
          params: {
            memberId: 'ev1:child',
            kindergarten: 'public',
            elementary: 'public',
            junior: 'public',
            high: 'public',
            university: 'none',
            overrides: {},
            growth: { type: 'none' },
          },
        },
      ],
    });
    const before = structuredClone(src);
    const copy = duplicateScenario(src, 'コピー', new Date('2026-02-01T00:00:00Z'));
    expect(src).toEqual(before);
    expect(copy.id).not.toBe(src.id);
    expect(copy.copiedFrom).toBe(src.id);
    const self = copy.members[0]!.id;
    expect(self).not.toBe('self');
    const f = copy.flows[0]!;
    expect(f.id).not.toBe('f1');
    expect(f.ownerId).toBe(self);
    expect(f.end && f.end.type === 'age' && f.end.memberId).toBe(self);
    const ev1 = copy.events[0]!;
    const ev2 = copy.events[1]!;
    expect(ev1.endsIds).toEqual([f.id]);
    expect(ev2.type === 'education' && ev2.params.memberId).toBe(`${ev1.id}:child`);
    expect(ev2.trigger.type === 'school' && ev2.trigger.memberId).toBe(`${ev1.id}:child`);
    // 自由記述は変換しない
    expect(ev1.name).toBe('第一子');
    // コピーを変更しても元は変わらない
    copy.flows[0]!.amount = 999;
    expect(src.flows[0]!.amount).toBe(1);
    expect(parseAppData(appData([src, copy])).ok).toBe(true);
  });
});

describe('バックアップファイル', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  it('エクスポート → インポートで等価', async () => {
    const d = appData([scenario({ flows: [flow({ id: 'f', amount: 5 })] })]);
    const text = await buildBackupFile(d, '1.0.0', now);
    const r = await parseBackupFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.data).toEqual(d);
      expect(r.preview.integrity).toBe('ok');
    }
  });
  it('改変されたファイルは integrity 不一致（警告）', async () => {
    const text = await buildBackupFile(appData(), '1.0.0', now);
    const obj = JSON.parse(text);
    obj.data.scenarios[0].name = '改変';
    const r = await parseBackupFile(JSON.stringify(obj));
    expect(r.ok && r.preview.integrity).toBe('mismatch');
  });
  it.each([
    ['壊れた JSON', '{"kind":', 'json'],
    ['別アプリ', JSON.stringify({ kind: 'other' }), 'kind'],
    ['新しすぎる形式', JSON.stringify({ kind: 'lifeplan-backup', fileVersion: 99, data: {} }), 'version'],
    ['データ欠落', JSON.stringify({ kind: 'lifeplan-backup', fileVersion: 1 }), 'format'],
    ['型違い', JSON.stringify({ kind: 'lifeplan-backup', fileVersion: 1, data: { app: 'lifeplan', schemaVersion: 1, scenarios: 1 } }), 'schema'],
  ])('%s は拒否', async (_n, text, stage) => {
    const r = await parseBackupFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.stage).toBe(stage);
  });
});
