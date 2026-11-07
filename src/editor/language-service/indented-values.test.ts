/**
 * Language-service features over indented values, parameter patterns, broken lists and recursive
 * aliases (proposal 5 §1, §2, §5, §6, notes 5, 9 and 10): hover, go-to-definition, references,
 * completion of remaining struct fields in indented values and after separating line breaks,
 * signature help with parameter patterns, folding ranges, and semantic tokens.
 */

import { describe, expect, it } from 'vitest';
import { textOf } from '../../foundation/text/span.ts';
import { completionsAt } from './completion/index.ts';
import { hoverAt } from './hover.ts';
import { mainProgram, programAt, treeOf } from './language-service.test-kit.ts';
import { nameAt } from './navigation/declarations.ts';
import { referencesAt } from './navigation/references.ts';
import { renameEdits } from './navigation/rename.ts';
import { foldingRangesOf } from './outline/folding.ts';
import { checkedModule } from './reading/checked-module.ts';
import { builtKeyTypesOf } from './semantic-tokens/built-keys.ts';
import { semanticTokensOf } from './semantic-tokens/semantic-tokens.ts';

function hover(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset);
}

function completedFields(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset)
    .filter(({ kind }) => kind === 'field')
    .map(({ name }) => name);
}

function completedNames(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

function highlighted(...lines: readonly string[]): readonly (readonly [string, string])[] {
  const tree = treeOf(...lines);
  return semanticTokensOf(tree).map(({ span, type }) => [textOf(tree.source, span), type]);
}

const serviceDecls = [
  'struct Retry:',
  '  times: Int = 3',
  '  backoffMs: Int',
  '',
  'struct Service:',
  '  name: String',
  '  replicas: Int = 1',
  '  retry: Retry',
  '',
];

describe('hover on indented values, parameter patterns and recursive aliases (notes 5, 9)', () => {
  it('shows the field, shorthand variable, and type in an indented value', () => {
    expect(
      hover(
        ...serviceDecls,
        'fn f(name: String) -> Service:',
        '  return Service:',
        '    name',
        '    re‸plicas: 2',
        '    retry:',
        '      backoffMs: 100',
      )?.code,
    ).toEqual(['(field) replicas: Int']);

    expect(
      hover(
        ...serviceDecls,
        'fn f(name: String) -> Service:',
        '  return Service:',
        '    na‸me',
        '    retry:',
        '      backoffMs: 100',
      )?.code,
    ).toEqual(['(field) name: String', '(variable) name: String']);

    expect(
      hover(
        ...serviceDecls,
        'fn f() -> Service:',
        '  return Ser‸vice:',
        '    name: "api"',
        '    retry:',
        '      backoffMs: 100',
      )?.code,
    ).toEqual(['(type) Service']);
  });
});

describe('navigation (go-to-definition and references) on indented values and parameter patterns (note 5)', () => {
  it('resolves a struct field key and type in an indented value to their declarations and includes them in references', () => {
    const lines = [
      ...serviceDecls,
      'fn f() -> Service:',
      '  return Service:',
      '    name: "api"',
      '    replicas: 2',
      '    retry:',
      '      back‸offMs: 100',
    ];
    const { program, module, offset } = programAt(...lines);
    const found = nameAt(program, module, offset);
    expect(found?.declarations.map(({ declared }) => declared.kind)).toEqual(['field']);
    const refs = referencesAt(program, module, offset);
    expect(refs).toHaveLength(2);
  });
});

describe('an indented value reads as the literal it builds, for hover and navigation (notes 3, 5)', () => {
  it("hovers the type a value names as its brace form's, instantiated", () => {
    const box = 'struct Box<T, E = String> { value: T }';
    const braces = hover(box, 'fn f() -> Box<Int>:', '  return B‸ox{value: 1}');
    const indented = hover(box, 'fn f() -> Box<Int>:', '  return B‸ox:', '    value: 1');
    expect(indented?.code).toEqual(braces?.code);
    expect(indented?.code.join('\n')).toContain('Box<Int, String>');
  });

  it("reaches a struct's field from the bare keys of an indented map keyed by its names", () => {
    const at = (...value: readonly string[]) => {
      const { program, module, offset } = programAt(
        'struct Settings { ret‸ries: Int, region: Int }',
        'fn f() -> Map<keyof Settings, Int>:',
        ...value,
      );
      return referencesAt(program, module, offset).length;
    };
    expect(at('  return', '    retries: 1', '    region: 2')).toBe(
      at('  return ["retries": 1, "region": 2]'),
    );
    expect(at('  return ["retries": 1, "region": 2]')).toBe(2);
  });

  it("renames a struct's field with the bare keys of an indented value checking built as a map", () => {
    const renaming = (...value: readonly string[]) => {
      const { program, module, offset } = programAt(
        'struct Settings { ret‸ries: Int, region: Int }',
        'fn f() -> Map<keyof Settings, Int>:',
        ...value,
      );
      return renameEdits(program, module, offset, 'attempts');
    };
    const indented = renaming('  return', '    retries: 1', '    region: 2');
    expect(indented?.kind).toBe('renamed');
    expect(indented?.kind === 'renamed' ? indented.edits : []).toHaveLength(2);
    expect(renaming('  return ["retries": 1, "region": 2]')?.kind).toBe('renamed');
  });
});

describe('completion in indented values and after separating line breaks (notes 5, 10)', () => {
  it('offers the remaining fields of a struct in a named or anonymous indented value', () => {
    expect(
      completedFields(
        ...serviceDecls,
        'fn f() -> Service:',
        '  const s = Service:',
        '    name: "api"',
        '    ‸',
        '  s',
      ),
    ).toEqual(['replicas', 'retry']);

    expect(
      completedFields(
        ...serviceDecls,
        'fn f() -> Service:',
        '  const s: Service =',
        '    name: "api"',
        '    retry:',
        '      times: 3',
        '      ‸',
        '  s',
      ),
    ).toEqual(['backoffMs']);
  });

  it("offers the fields of an anonymous value after 'return' and under a key with no entry yet", () => {
    expect(
      completedFields(...serviceDecls, 'fn f() -> Service:', '  return', '    name: "x"', '    ‸'),
    ).toEqual(['replicas', 'retry']);
    expect(
      completedFields(
        ...serviceDecls,
        'fn f() -> Service:',
        '  const b: Service =',
        '    name: "x"',
        '    retry:',
        '      ‸',
        '  b',
      ),
    ).toEqual(['times', 'backoffMs']);
  });

  it("offers a value's names, its variants among them, where an indented value names its type", () => {
    const paint = ['enum Paint:', '  Red(shade: Int)', '  Blue(shade: Int)', ''];
    expect(completedNames(...paint, 'fn f() -> Paint:', '  return Re‸:', '    shade: 1')).toEqual(
      expect.arrayContaining(['Red', 'Blue']),
    );
  });

  it('offers the keys the key type of an indented map spells that no entry gives yet, quoted where no name', () => {
    expect(
      completedNames(
        'fn f() -> Map<"region" | "x-tier" | "zone", Int>:',
        '  return',
        '    region: 1',
        '    ‸',
      ),
    ).toEqual(['"x-tier"', 'zone']);
  });

  it('offers a leading spread and field shorthands at the first entry of an indented value', () => {
    const names = completedNames(
      ...serviceDecls,
      'fn f(name: String) -> Service:',
      '  return Service:',
      '    ‸',
    );
    expect(names).toEqual(expect.arrayContaining(['...', 'name', 'replicas', 'retry']));
  });

  it('offers the next field or call argument after a separating line break without a comma (§6, note 10)', () => {
    expect(
      completedFields(
        'struct Pair { first: Int, second: Int }',
        'fn f() -> Pair:',
        '  Pair{',
        '    first: 1',
        '    ‸',
        '  }',
      ),
    ).toEqual(['second']);

    expect(
      completedNames(
        'fn connect(host: String, port: Int) -> Int: port',
        'fn f() -> Int:',
        '  connect(',
        '    host: "localhost"',
        '    ‸',
        '  )',
      ),
    ).toContain('port:');
  });
});

describe('signature help, folding and semantic tokens (notes 5, 9)', () => {
  it('folds an indented value block and its nested entry blocks', () => {
    const tree = treeOf(
      'const api = Service:',
      '  name: "api"',
      '  ports:',
      '    - 80',
      '    - 443',
      '  retry:',
      '    times: 3',
      '    backoffMs: 200',
    );
    expect(foldingRangesOf(tree)).toEqual([
      { start: 0, end: 7 },
      { start: 2, end: 4 },
      { start: 5, end: 7 },
    ]);
  });

  it('highlights a struct indented value type as "type" and its field keys as "property"', () => {
    expect(highlighted('const p = Pair:', '  first: 1', '  second')).toEqual([
      ['const', 'keyword'],
      ['p', 'variable'],
      ['=', 'operator'],
      ['Pair', 'type'],
      ['first', 'property'],
      ['1', 'number'],
      ['second', 'property'],
    ]);
  });

  it('highlights the bare keys of an indented map as Strings, and a shorthand as its variable', () => {
    const { program, module, tree } = mainProgram(
      [
        'fn f(host: String) -> Map<String, String>:',
        '  return',
        '    LOG_LEVEL: "debug"',
        '    host',
      ].join('\n'),
    );
    const checked = checkedModule(program, module);
    const keys = checked === undefined ? new Map() : builtKeyTypesOf(checked);
    const kinds = semanticTokensOf(tree, keys).map(({ span, type }) => [
      textOf(tree.source, span),
      type,
    ]);
    expect(kinds).toContainEqual(['LOG_LEVEL', 'string']);
    expect(kinds.filter(([text]) => text === 'host')).toEqual([
      ['host', 'parameter'],
      ['host', 'variable'],
    ]);
  });
});
