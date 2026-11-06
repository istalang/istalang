/**
 * Tools on a call inside a field loop whose passes resolve it to different functions (§4): each
 * pass checks the same text against another field's type, so the call names every function a pass
 * called, as a type there names every pass's type.
 */

import { describe, expect, it } from 'vitest';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';
import { nameAt, spanOfUse } from './navigation/declarations.ts';
import { referencesAt } from './navigation/references.ts';
import { signatureHelpAt } from './signature-help.ts';

/** `show(v)` calls `show(Int)` in pass `a` and `show(String)` in pass `b`; `marked` holds the cursor. */
function showInLoop(marked: { readonly declaration?: 'Int' | 'String'; readonly call?: string }) {
  const declared = (type: 'Int' | 'String', result: number) =>
    `fn ${marked.declaration === type ? 'sh‸ow' : 'show'}(x: ${type}) -> Int: ${result}`;
  return programAt(
    'struct Pair:',
    '  a: Int',
    '  b: String',
    declared('Int', 1),
    declared('String', 2),
    'fn f(p: Pair) -> Int:',
    '  let n = 0',
    '  for k, v in ...p:',
    `    n += ${marked.call ?? 'show(v)'}`,
    '  n',
  );
}

const signatures = ['fn show(x: Int) -> Int', 'fn show(x: String) -> Int'];

describe('a call its field loop passes resolve differently', () => {
  it('is a reference of every function a pass called', () => {
    for (const declaration of ['Int', 'String'] as const) {
      const { program, module, offset } = showInLoop({ declaration });
      const call = program.modules.get(module)?.tree.source.text.indexOf('show(v)');
      const found = referencesAt(program, module, offset).map(
        (each) => spanOfUse(program, each).start,
      );
      expect(found).toContain(call);
    }
  });

  it('goes to the definition of every function a pass called', () => {
    const { program, module, offset } = showInLoop({ call: 'sh‸ow(v)' });
    expect(nameAt(program, module, offset)?.declarations).toHaveLength(2);
  });

  it("shows every called function's signature on hover", () => {
    const { program, module, offset } = showInLoop({ call: 'sh‸ow(v)' });
    expect(hoverAt(program, module, offset)?.code).toEqual(signatures);
  });

  it('offers every candidate, and marks none active, in signature help', () => {
    const { program, module, offset } = showInLoop({ call: 'show(‸v)' });
    const help = signatureHelpAt(program, module, offset);
    expect(help?.signatures.map(({ label }) => label)).toEqual(signatures);
    expect(help?.active).toBeUndefined();
  });
});
