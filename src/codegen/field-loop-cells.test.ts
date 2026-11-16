/**
 * A variable living in a cell inside a field loop holds each pass's value (§4, §7): compiled code
 * counts its cell as lowering counts its register, so the lease one pass makes stays held until that
 * pass ends. The interpreter makes the cell as the first pass's type says and never disposes it
 * (tracker B114), so this holds compiled JavaScript to the spec alone.
 */

import { describe, expect, it } from 'vitest';
import { corpusDirectory } from '../../test/corpus/programs.ts';
import { compiledAt, compiledToJavaScript, shownByJavaScript } from './differential.test-kit.ts';

const program = [
  "import * as log from 'log'",
  'shared struct Lease { id: Int }',
  'fn dispose(self: Lease): log.info("disposed " + String(self->id))',
  'fn touch<T>(x: &T): ()',
  'fn make(n: Int) -> Int: n',
  'fn make(s: String) -> Lease: new Lease{id: 7}',
  'struct Pair { a: Int, b: String }',
  'fn walk(pair: Pair):',
  '  for key, value in ...pair:',
  '    let made = make(value)',
  '    touch(&made)',
  '    log.info("visit " + key)',
  'live async fn main() -> Int:',
  '  walk(Pair{a: 1, b: "hi"})',
  '  log.info("after walk")',
  '  0',
].join('\n');

describe('a cell variable of a field loop', () => {
  it('holds the lease its pass makes until the pass ends', async () => {
    const compiled = compiledAt(corpusDirectory, 'field-loop-cells.ista', program);
    if ('problem' in compiled) {
      throw new Error(compiled.problem);
    }
    const compiledJavaScript = await compiledToJavaScript(compiled.definition);
    if (typeof compiledJavaScript === 'string') {
      throw new Error(compiledJavaScript);
    }
    const shown = await shownByJavaScript(compiledJavaScript);
    expect(shown.logs).toEqual([
      'info visit a {}',
      'info visit b {}',
      'info disposed 7 {}',
      'info after walk {}',
    ]);
  });
});
