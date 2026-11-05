/**
 * Properties of the line-break rule between list items (proposal 5 §6, note 11), over generated
 * lists and hostile token runs: a line break in place of any comma, or anywhere an item continues,
 * gives the tree its one-line form gives, and parsing stays total with every error explained.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { soupOf } from '../../../../test/soup.ts';
import { createSourceText } from '../../../text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import { errorNodes, spanViolations, strayBodies } from '../../syntax/tree.test-kit.ts';
import { dumpClean } from '../parse.test-kit.ts';
import { parse } from '../parse.ts';

describe('properties and hostile inputs (§6, note 11)', () => {
  const simpleItems = fc.constantFrom(
    '1',
    '"s"',
    'true',
    'none',
    'a',
    'a + b',
    'f(1, 2)',
    'Pair{x: 1, y: 2}',
    '[1, 2]',
    '(1, "x")',
  );

  it('gives the same tree when any comma in a generated list is replaced with a line break', () => {
    fc.assert(
      fc.property(
        fc.array(simpleItems, { minLength: 2, maxLength: 6 }),
        fc.array(fc.constantFrom(', ', '\n  ', ',\n  ', '\n  # note\n  '), {
          minLength: 5,
          maxLength: 5,
        }),
        (items, joins) => {
          const inline = `[${items.join(', ')}]`;
          const broken = `[\n  ${items
            .map((item, index) =>
              index === 0 ? item : `${joins[(index - 1) % joins.length]}${item}`,
            )
            .join('')}\n]`;
          expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('gives the same tree when an item is broken at any continuing operator or clause', () => {
    const continuations: (readonly [string, string])[] = [
      ['a + b', 'a\n    + b'],
      ['a - 1', 'a\n    - 1'],
      ['a * 2', 'a\n    * 2'],
      ['a & b', 'a\n    & b'],
      ['0..10 by 2', '0\n    .. 10\n    by 2'],
      ['x.y?.z->w!', 'x\n    .y\n    ?.z\n    ->w\n    !'],
      ['if c: 1 elif d: 2 else: 3', 'if c: 1\n    elif d: 2\n    else: 3'],
      ['x is Int as n', 'x\n    is Int\n    as n'],
      ['x in xs and y not in ys', 'x\n    in xs\n    and y\n    not in ys'],
    ];
    fc.assert(
      fc.property(fc.subarray(continuations, { minLength: 2, maxLength: 5 }), (chosen) => {
        const inline = `[${chosen.map(([oneLine]) => oneLine).join(', ')}]`;
        const broken = `[\n  ${chosen.map(([, multiLine]) => multiLine).join('\n  ')}\n]`;
        expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
      }),
      { numRuns: 50 },
    );
  });

  it('stays total and well-nested on hostile bracketed inputs with glued and spaced operators', () => {
    const hostileFragments = [
      'a',
      '1',
      '-1',
      '- 1',
      '*x',
      '* x',
      '&x',
      '& x',
      '..5',
      '.. 5',
      '..=5',
      '..= 5',
      '(1)',
      '[0]',
      '{a: 1}',
      '<Int>',
      ',',
      ';',
      ':',
      '# c',
    ];
    const hostileSoup = soupOf(hostileFragments, [' ', '\n  ', '\n    ', '\n'], 20);
    fc.assert(
      fc.property(hostileSoup, (inner) => {
        const source = createSourceText('hostile.ista', `fn f(): [\n  ${inner}\n]\n`);
        const tree = parse(source, scan(source));
        const unexplained = errorNodes(tree, tree.root).length > 0 && tree.diagnostics.length === 0;
        expect(spanViolations(tree, tree.root)).toEqual([]);
        expect(strayBodies(tree)).toEqual([]);
        expect(unexplained).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
