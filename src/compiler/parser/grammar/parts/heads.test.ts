/**
 * Heads (§2): a head's modifiers stack in any order, giving the tree their print order gives, in
 * every form; a repeated, conflicting or misplaced one costs one diagnostic naming it, and one
 * implying another of its group (`sendable inert`) none, the tree holding the stronger.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import {
  type HeadForm,
  headForms,
  type ModifierGroup,
  type ModifierWord,
  modifierGroups,
} from '../../../syntax/tokens/modifiers.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { type Category, dumpClean, dumpOf, parseAs, reported } from '../../parse.test-kit.ts';

const { conflictingModifiers, expected, misplacedModifier, repeatedModifier } = parserDiagnostics;

/** Where a form stands in a test: how its text is parsed, and what follows its head. */
interface Place {
  readonly form: HeadForm;
  readonly category: Category;
  /** The words every head of the place holds, `extern` an extern's, in print order. */
  readonly required: readonly ModifierWord[];
  /** The groups a head of the place may take a word of, or none. */
  readonly optional: readonly ModifierGroup[];
  readonly rest: string;
}

const places: readonly Place[] = [
  {
    form: headForms.functionType,
    category: 'type',
    required: [],
    optional: ['send', 'kind', 'async'],
    rest: '(A) -> R',
  },
  {
    form: headForms.lambda,
    category: 'expression',
    required: [],
    optional: ['kind', 'async'],
    rest: '(x): x',
  },
  {
    form: headForms.function,
    category: 'module',
    required: [],
    optional: ['kind', 'async'],
    rest: ' f(): 1',
  },
  {
    form: headForms.function,
    category: 'module',
    required: ['extern'],
    optional: ['kind', 'async'],
    rest: ' f() -> Int',
  },
  {
    form: headForms.externStruct,
    category: 'module',
    required: ['extern'],
    optional: ['handle'],
    rest: ' H',
  },
  {
    form: headForms.sharedStruct,
    category: 'module',
    required: ['shared'],
    optional: [],
    rest: ' S',
  },
];

/** `place`'s required words and a word of each optional group or none, in print order. */
function modifiersOf(place: Place): fc.Arbitrary<readonly ModifierWord[]> {
  return fc
    .tuple(
      ...place.optional.map((group) =>
        fc.option(fc.constantFrom(...modifierGroups[group]), { nil: undefined }),
      ),
    )
    .map((chosen) => [...place.required, ...chosen.filter((word) => word !== undefined)]);
}

function headText(place: Place, modifiers: readonly string[]): string {
  return `${[...modifiers, place.form.keyword].join(' ')}${place.rest}`;
}

describe('modifiers in any order', () => {
  it.each(places)('give $form.name the tree of their print order', (place) => {
    fc.assert(
      fc.property(
        modifiersOf(place).chain((modifiers) =>
          fc.tuple(
            fc.constant(modifiers),
            fc.shuffledSubarray([...modifiers], { minLength: modifiers.length }),
          ),
        ),
        ([inOrder, shuffled]) => {
          const tree = dumpClean(place.category, headText(place, inOrder));
          expect(tree).not.toContain('NOT CLEAN');
          expect(dumpClean(place.category, headText(place, shuffled))).toBe(tree);
        },
      ),
    );
  });

  it('keep each word under its meaning', () => {
    expect(dumpClean('type', 'async ista sendable fn(A)')).toBe(
      '(FunctionType sendable ista async [(NamedType [A] [])] _)',
    );
    expect(dumpClean('module', 'shared extern struct H')).toContain(
      '(ExternStructDeclaration shared H [] [] [])',
    );
  });
});

describe('a modifier implying another of its group', () => {
  it('is what a head writing both means, in either order, with no report', () => {
    const sendable = dumpClean('type', 'sendable live fn(A)');
    expect(dumpClean('type', 'sendable inert live fn(A)')).toBe(sendable);
    expect(dumpClean('type', 'inert live sendable fn(A)')).toBe(sendable);
  });

  it('leaves the implied word a head of its own, and a name elsewhere', () => {
    expect(dumpClean('type', 'inert live async fn(A)')).toBe(
      '(FunctionType inert live async [(NamedType [A] [])] _)',
    );
    expect(dumpClean('module', 'fn f(inert: Int) -> Int: inert')).not.toContain('NOT CLEAN');
  });
});

describe('a stray modifier', () => {
  it.each([
    ['type', 'async async fn(A)', repeatedModifier, 'async'],
    ['type', 'sendable sendable fn(A)', repeatedModifier, 'sendable'],
    ['type', 'inert inert fn(A)', repeatedModifier, 'inert'],
    ['type', 'sendable inert inert fn(A)', repeatedModifier, 'inert'],
    ['type', 'inert sendable inert fn(A)', repeatedModifier, 'inert'],
    ['type', 'live ista fn(A)', conflictingModifiers, 'ista'],
    ['module', 'extern extern fn f()', repeatedModifier, 'extern'],
    ['module', 'extern shared sendable struct H', conflictingModifiers, 'sendable'],
    ['module', 'sendable extern live struct H', conflictingModifiers, 'live'],
    ['module', 'trait T:\n  extern fn f()', misplacedModifier, 'extern'],
  ] as const)('in %s `%s` is reported once, by name', (category, text, diagnostic, word) => {
    expect(reported(category, text)).toEqual(reportedOnce(diagnostic.code, word));
    const [message] = parseAs(category, text).diagnostics.map((each) => each.message);
    expect(message).toContain(`'${word}'`);
  });

  it.each([
    ['type', ['async', 'shared'], 'fn(A)', misplacedModifier],
    ['type', ['sendable', 'extern'], 'fn(A)', misplacedModifier],
    ['expression', ['async', 'sendable'], 'fn(x): x', misplacedModifier],
    ['expression', ['inert'], 'fn(x): x', misplacedModifier],
    ['module', ['inert'], 'fn f(): 1', misplacedModifier],
    ['module', ['extern', 'inert'], 'struct H', misplacedModifier],
    ['expression', ['async', 'extern'], 'fn(x): x', misplacedModifier],
    ['module', ['async', 'sendable'], 'fn f(): 1', misplacedModifier],
    ['module', ['extern', 'sendable'], 'fn f()', misplacedModifier],
    ['module', ['extern', 'async'], 'fn()', expected],
    ['module', ['extern', 'async'], 'struct H', misplacedModifier],
    ['module', ['shared', 'async'], 'struct S', misplacedModifier],
    ['module', ['shared', 'sendable'], 'struct S', misplacedModifier],
    ['module', ['async'], 'struct S', misplacedModifier],
  ] as const)(
    'in %s, `%s %s` gives one tree and one report in either order',
    (category, words, rest, diagnostic) => {
      const [first, ...others] = [words, words.toReversed()].map((order) => {
        const parsed = parseAs(category, `${order.join(' ')} ${rest}`);
        return { tree: dumpOf(parsed), codes: parsed.diagnostics.map((each) => each.code) };
      });
      expect(others).toEqual([first]);
      expect(first?.codes).toEqual([diagnostic.code]);
    },
  );
});
