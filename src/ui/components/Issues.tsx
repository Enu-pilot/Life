import { Link } from 'react-router';
import type { Issue } from '../../engine';
import { Banner } from './common';

/** エンジンの検証結果（エラー・警告）を表示する */
export function Issues({ issues, compact }: { issues: Issue[]; compact?: boolean }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <>
      {errors.length > 0 && (
        <Banner kind="error">
          <strong>計算できません</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                {e.message}
                {e.code === 'NO_SELF' && (
                  <>
                    {' '}
                    <Link to="/profile">プロフィールへ</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner kind="warn">
          <strong>確認が必要な点（{warnings.length}件）</strong>
          <ul>
            {(compact ? warnings.slice(0, 5) : warnings).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
            {compact && warnings.length > 5 && <li>ほか {warnings.length - 5} 件（資産推移の画面で確認できます）</li>}
          </ul>
        </Banner>
      )}
    </>
  );
}
