// インポート前の確認（アプリ層: 保存層の検証結果に計算エンジンの検証を加える）
import type { AppData } from '../domain/schema';
import { compile } from '../engine';

/** 計算時にエラーになるシナリオ（読み込みは可能。読み込み後に画面で修正できる） */
export function scenarioProblems(data: AppData): string[] {
  return data.scenarios.flatMap((s) =>
    compile(s)
      .issues.filter((i) => i.level === 'error')
      .map((i) => `「${s.name}」: ${i.message}`),
  );
}
