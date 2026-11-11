/**
 * Field-default functions (`fieldsFunctionOf`, §3.1): each says whose fields it reads, a struct's
 * or an enum variant's, and its entry, computing the defaults a literal or a call leaves out, is
 * named after them, the variant's with its enum, so identically named variants in one module lower
 * to distinct entries.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../compile.test-kit.ts';
import { parseAs } from '../../parser/parse.test-kit.ts';
import { childrenOf } from '../tree/index.ts';
import { fieldsFunctionsOf, isFieldsFunction } from './field-defaults.ts';

describe('fieldsFunctionOf', () => {
  it('qualifies enum variant field-default functions with their enum name', () => {
    const main = [
      'enum Shape:',
      '  Circle(r: Int = 1)',
      'enum Icon:',
      '  Circle(r: Int = 2)',
      "import * as runtime from 'runtime'\nlive async fn main() -> (Shape, Icon): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Shape, Icon):",
      '  (Shape.Circle(), Icon.Circle())',
    ].join('\n');
    const definition = compiledDefinition(stdProgramOf({ main }), 'main');
    const names = definition.functions.map((entry) => entry.name);
    expect(names).toContain('main.Shape.Circle');
    expect(names).toContain('main.Icon.Circle');
  });

  it("names a struct's entry computing its defaults after the struct", () => {
    const main = [
      'struct Retry:',
      '  times: Int = 3',
      '  label: String',
      'import * as runtime from \'runtime\'\nlive async fn main() -> Retry: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Retry: Retry{label: "a"}',
    ].join('\n');
    const names = compiledDefinition(stdProgramOf({ main }), 'main').functions.map(
      (entry) => entry.name,
    );
    expect(names).toContain('main.Retry');
  });

  it('tells a fields function apart by whose fields it reads, never by a static owner', () => {
    const { node: root } = parseAs(
      'module',
      [
        'struct Retry:',
        '  times: Int = 3',
        'enum Shape:',
        '  Circle(r: Int = 1)',
        'fn f(): 1',
      ].join('\n'),
    );
    if (root.kind !== 'Module') {
      throw new Error('Expected a module.');
    }
    const made = root.items.flatMap(fieldsFunctionsOf);
    expect(made.map((declaration) => isFieldsFunction(declaration))).toEqual([true, true]);
    expect(made.map((declaration) => declaration.owner)).toEqual([undefined, undefined]);
    const written = root.items.filter((item) => item.kind === 'FunctionDeclaration');
    expect(written.map((declaration) => isFieldsFunction(declaration))).toEqual([false]);
  });

  it('walks as a node whose children are its parameters, never its owner', () => {
    const parsed = parseAs(
      'module',
      ['struct Retry:', '  times: Int = 3', 'enum Shape:', '  Circle(r: Int = 1)'].join('\n'),
    );
    const root = parsed.node;
    if (root.kind !== 'Module') {
      throw new Error('Expected a module.');
    }
    for (const made of root.items.flatMap(fieldsFunctionsOf)) {
      expect(childrenOf(parsed, made).map((child) => child.kind)).toEqual([
        'Identifier',
        'Parameter',
      ]);
    }
  });
});
