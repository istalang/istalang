/**
 * The constraint checks a module's check runs (type-parameters.ts): each is an entry, so a checker
 * made after an edit inside a body runs again only the checks that body notes, and reports what
 * every check found as a checker made afresh does.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { checkedApart } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const main = idOf('main.ista');

/** A module whose `unmet` body notes an unmet constraint, and whose bodies end as `endings` say. */
function textOf(endings: { readonly unmet: string; readonly plain: string }): string {
  return [
    'trait Priced { cents: Int }',
    'struct Plain { name: String }',
    'struct Box<T is Priced> { item: T }',
    'fn unmet() -> Int:',
    '  const box: Box<Plain>? = none',
    `  ${endings.unmet}`,
    'fn plain() -> Int:',
    `  ${endings.plain}`,
    '',
  ].join('\n');
}

/** How many constraint checks each revision ran, before and after `edited`, and what it reports. */
function checksRun(edited: { readonly unmet: string; readonly plain: string }) {
  const first = stdProgramOf({ 'main.ista': textOf({ unmet: '1', plain: '1' }) });
  const second = stdProgramOf({ 'main.ista': textOf(edited) }, first);
  const counted = (count: { run: number }) => (table: string) => {
    if (table === 'constraint checks') {
      count.run += 1;
    }
  };
  const before = { run: 0 };
  const previous = checkedApart(first, { observe: counted(before) });
  previous.diagnosticsOf(main);
  const after = { run: 0 };
  const diagnostics = checkedApart(second, { previous, observe: counted(after) }).diagnosticsOf(
    main,
  );
  return { before: before.run, after: after.run, diagnostics, fresh: checkedApart(second) };
}

describe('after an edit inside a body', () => {
  it('runs no constraint check again when that body notes none', () => {
    const { before, after, diagnostics, fresh } = checksRun({ unmet: '1', plain: '2' });
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(0);
    expect(diagnostics.map(({ code }) => code)).toEqual([checkerDiagnostics.notConforming.code]);
    expect(diagnostics).toEqual(fresh.diagnosticsOf(main));
  });

  it('runs again the constraint checks that body notes, reporting what they find', () => {
    const { before, after, diagnostics, fresh } = checksRun({ unmet: '2', plain: '1' });
    expect(after).toBe(before);
    expect(diagnostics.map(({ code }) => code)).toEqual([checkerDiagnostics.notConforming.code]);
    expect(diagnostics).toEqual(fresh.diagnosticsOf(main));
  });
});
