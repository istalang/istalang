/**
 * What an editor shows of a recursive alias (proposal 5 §2): a use is spelled as its alias in
 * hovers, as in messages, with what it stands for beside it, as an alias's use is shown.
 */

import { describe, expect, it } from 'vitest';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';

function hover(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset);
}

describe('hover on recursive aliases', () => {
  it('shows a recursive alias by its alias spelling', () => {
    expect(
      hover('type Tree<T> = T | Array<Tree<T>>', 'fn f(t: Tree<Int>) -> Tree<Int>: t‸')?.code,
    ).toContain('(variable) t: Tree<Int>');
  });

  it('shows a Json value as json.Json, not as its members', () => {
    expect(hover("import Json from 'json'", 'fn f(j: Json) -> Json: j‸')?.code).toContain(
      '(variable) j: Json',
    );
  });
});
