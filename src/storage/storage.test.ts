import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as idb from 'idb-keyval';
import { appData, flow, scenario } from '../../tests/unit/fixtures';
import { duplicateScenario } from '../domain/factory';
import { CURRENT_SCHEMA_VERSION, parseAppData } from '../domain/schema';
import { simulate } from '../engine';
import { scenarioProblems } from '../app/importCheck';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupFileName, buildBackupFile, parseBackupFile } from './backupFile';
import { migrate } from './migrations';
import { MAX_BACKUPS, Repository, requestPersistence } from './repository';

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
    expect(r.ok && r.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
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
    const v1: any = { ...structuredClone(appData()), schemaVersion: 1 };
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
  const v1 = () => ({ ...appData(), schemaVersion: 1 });
  it('移行結果のバージョンが不正なら拒否', () => {
    const r = migrate(v1(), { 1: (d) => d }, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
  it('移行関数が例外を投げたら migration 段階で拒否', () => {
    const r = migrate(v1(), { 1: () => { throw new Error('boom'); } }, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
  it('移行関数がない場合は拒否', () => {
    const r = migrate(v1(), {}, 2);
    expect(!r.ok && r.stage).toBe('migration');
  });
});

describe('v1 → v2 の移行（実データ fixture）', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/appdata-v1.json'), 'utf8'));
  it('v1 の保存データを v2 に移行でき、スキーマに適合する', () => {
    const before = structuredClone(raw);
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fromVersion).toBe(1);
    expect(r.data.schemaVersion).toBe(2);
    // 元データは変更しない
    expect(raw).toEqual(before);
    // 年金イベントには claimAdjustment: false（従来どおり入力額をそのまま使う）が補われる
    const pensions = r.data.scenarios[0]!.events.filter((e) => e.type === 'pension');
    expect(pensions.length).toBeGreaterThan(0);
    for (const p of pensions) expect(p.type === 'pension' && p.params.claimAdjustment).toBe(false);
    // それ以外の項目は意味的に等価（設定・シナリオ名・収支・口座）
    expect(r.data.settings).toEqual(raw.settings);
    expect(r.data.scenarios[0]!.flows).toEqual(raw.scenarios[0].flows);
    expect(r.data.scenarios[0]!.accounts).toEqual(raw.scenarios[0].accounts);
  });
  it('移行前後で計算結果が変わらない', () => {
    const r = migrate(raw);
    if (!r.ok) throw new Error('migrate');
    const expected = JSON.parse(readFileSync(join(__dirname, '../../tests/golden/G-03-family-education-rent.expected.json'), 'utf8'));
    const sim = simulate(r.data.scenarios[0]!);
    expect(sim.ok && sim.yearly.map((y) => y.netWorth)).toEqual(expected.years.map((y: { netWorth: number }) => y.netWorth));
  });
  it('Repository は v1 データを読み込むと移行前データを退避し、v2 で保存し直す', async () => {
    const repo = freshRepo();
    await repo.kv.set('data', raw);
    const r = await repo.load();
    expect(r.status === 'ok' && r.migratedFrom).toBe(1);
    const backups = await repo.listBackups();
    expect(backups[0]!.reason).toBe('migration');
    expect((backups[0]!.data as any).schemaVersion).toBe(1);
    expect(((await repo.kv.get('data')) as any).schemaVersion).toBe(2);
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
    ['型違い', JSON.stringify({ kind: 'lifeplan-backup', fileVersion: 1, data: { app: 'lifeplan', schemaVersion: 2, scenarios: 1 } }), 'schema'],
  ])('%s は拒否', async (_n, text, stage) => {
    const r = await parseBackupFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.stage).toBe(stage);
  });
});

describe('データ保護（Phase 6）', () => {
  it('置き換え後の読み戻しが一致しなければ元に戻して失敗する', async () => {
    const base = freshRepo();
    await base.save(appData([scenario({ name: 'A' })]));
    const corrupting = new Repository({
      get: (k) => base.kv.get(k),
      del: (k) => base.kv.del(k),
      // 書き込み時にデータを壊す保存領域を模擬
      set: async (k, v) => base.kv.set(k, k === 'data' && (v as any)?.scenarios?.[0]?.name === 'B' ? { ...(v as object), scenarios: [] } : v),
    });
    await expect(corrupting.replace(appData([scenario({ name: 'B' })]), 'import')).rejects.toThrow('確認に失敗');
    const r = await base.load();
    expect(r.status === 'ok' && r.data.scenarios[0]!.name).toBe('A');
  });
  it('インポートのプレビューで計算できないシナリオを知らせる（読み込み自体は可能）', async () => {
    const d = appData([scenario({ name: '本人なし', members: [] })]);
    const r = await parseBackupFile(await buildBackupFile(d, '1.0.0', new Date()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(scenarioProblems(r.preview.data)[0]).toContain('本人の生年月');
  });
  it('値の範囲外・必須欠落・未知のバージョンを拒否し、拒否理由に項目のパスを含める', async () => {
    const bad = JSON.parse(await buildBackupFile(appData(), '1.0.0', new Date()));
    bad.data.scenarios[0].flows = [{ id: 'x', direction: 'income', name: 'x', category: 'salary', amount: -5, frequency: 'monthly', start: null, end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 1 }];
    const r = await parseBackupFile(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.stage).toBe('schema');
      expect(r.error.issues!.join('\n')).toContain('scenarios.0.flows.0.amount');
    }
    const future = JSON.parse(await buildBackupFile(appData(), '1.0.0', new Date()));
    future.data.schemaVersion = 99;
    const r2 = await parseBackupFile(JSON.stringify(future));
    expect(!r2.ok && r2.error.stage).toBe('version');
  });
  it('巨大ファイルは拒否', async () => {
    const r = await parseBackupFile(' '.repeat(20 * 1024 * 1024 + 1));
    expect(!r.ok && r.error.stage).toBe('size');
  });
});

describe('保存領域の補助機能', () => {
  it('バックアップのファイル名は日時を含む', () => {
    expect(backupFileName(new Date(2026, 9, 26, 9, 5))).toBe('lifeplan-backup-20261026-0905.json');
  });
  it('clear で保存データを削除する（退避世代は残る）', async () => {
    const repo = freshRepo();
    await repo.save(appData());
    await repo.pushBackup('daily', { x: 1 });
    await repo.clear();
    expect((await repo.load()).status).toBe('empty');
    expect(await repo.listBackups()).toHaveLength(1);
  });
  it('永続化の要求: 許可済み・新たに許可・非対応・例外', async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setNav = (v: unknown) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true });
    try {
      setNav({ storage: { persisted: async () => true, persist: async () => false } });
      expect(await requestPersistence()).toBe(true);
      setNav({ storage: { persisted: async () => false, persist: async () => true } });
      expect(await requestPersistence()).toBe(true);
      setNav({});
      expect(await requestPersistence()).toBeNull();
      setNav({ storage: { persisted: async () => { throw new Error('x'); }, persist: async () => true } });
      expect(await requestPersistence()).toBeNull();
    } finally {
      if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    }
  });
});
