/**
 * What the std's externs hold and keep (§5.5): `@Holds` read by everything asking what a value
 * holds, `@Keeps` read by parameter position, and either refused off the std's externs.
 */

import { describe, expect, it } from 'vitest';
import {
  reportedIn,
  reportedNothing,
} from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { stdModuleSources } from '../../../../stdlib/std-sources.ts';
import { stdlibLoader, stdRoles } from '../../../../stdlib/stdlib-loader.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { programOf } from '../../../program/program.test-kit.ts';
import { programModule, stdModuleIdOf } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { checkedApart, reported } from '../../check.test-kit.ts';
import { heldTypes } from '../../types/properties/held.ts';
import type { NominalType, Type } from '../../types/type/index.ts';
import { intType, literalType, tupleType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';

const checker = checkedApart(stdProgramOf({ 'main.ista': '' }));

const ista = literalType('ista');

function preludeType(name: keyof typeof wellKnown, ...typeArguments: Type[]): NominalType {
  const type = checker.wellKnownType(wellKnown[name], typeArguments);
  if (type === undefined) {
    throw new Error(`The prelude declares no ${name}`);
  }
  return type;
}

/** The prelude's function `name` whose first parameter is a `receiver`. */
function preludeMethod(name: string, receiver: keyof typeof wellKnown): FunctionDeclaration {
  const entity = checker.wellKnownEntity(wellKnown[receiver]);
  const found = checker.languageFunctions('prelude', name).find((declaration) => {
    const [self] = checker.parametersOf(declaration);
    return self?.type.kind === 'nominal' && self.type.entity === entity;
  });
  if (found === undefined) {
    throw new Error(`The prelude declares no ${name} on ${receiver}`);
  }
  return found;
}

describe('what a value of an extern type holds', () => {
  it("is what its @Holds names: a weak reference's nothing, even of a future", () => {
    const weak = preludeType('weakRef', preludeType('future', intType, ista));
    expect(heldTypes(checker, weak).map(typeText)).toEqual([typeText(weak)]);
  });

  it("is its type arguments without one, or what @Holds names at them: a future's value and waiters", () => {
    const future = preludeType('future', preludeType('slot', intType), ista);
    expect(checker.externHeldOf(future).map(typeText)).toEqual([
      'Slot<Int>',
      '_Waiters<Slot<Int>, "ista">',
      'ista fn(Slot<Int>) -> Unit',
      'ista fn() -> Unit',
    ]);
    expect(checker.externHeldOf(preludeType('array', intType)).map(typeText)).toEqual(['Int']);
  });

  it('is a tuple argument whole where @Holds names its parameter alone', () => {
    const pair = tupleType([intType, preludeType('slot', intType)]);
    expect(checker.externHeldOf(preludeType('slot', pair)).map(typeText)).toEqual([
      '(Int, Slot<Int>)',
    ]);
  });

  it('lets a weak reference to a future be lost, where a tuple of one must be used', () => {
    const text = lines(
      'ista fn weak(future: Future<Int, "ista">) -> WeakRef<Future<Int, "ista">>:',
      '  WeakRef.from(future)',
      'ista fn tuple(future: Future<Int, "ista">) -> (Future<Int, "ista">,):',
      '  (future,)',
      'ista fn main(future: Future<Int, "ista">):',
      '  weak(future)',
      '  tuple(future)',
      '  ()',
    );
    expect(reported(text).codes).toEqual([5025]);
  });
});

describe('what an extern function keeps', () => {
  it("is its @Keeps', by position: a slot's put keeps the value put", () => {
    expect(checker.keepsOf(preludeMethod('put', 'slot'))).toEqual([{ holder: 0, kept: [1] }]);
  });

  it('is, without one, what each & parameter may store: every other', () => {
    expect(checker.keepsOf(preludeMethod('push', 'array'))).toEqual([{ holder: 0, kept: [1] }]);
  });

  it('is nothing for one taking nothing by &', () => {
    expect(checker.keepsOf(preludeMethod('take', 'slot'))).toEqual([]);
  });
});

/** What checking reports in a std module of `text`, which `main.ista` imports. */
function reportedInStd(text: string) {
  const sources = { ...stdModuleSources, extra: text };
  const program = programOf(
    { 'main.ista': "import * as extra from 'extra'\n" },
    { roles: stdRoles(sources), loaders: [stdlibLoader(sources)] },
  );
  const id = stdModuleIdOf('extra');
  const diagnostics = checkedApart(program).diagnosticsOf(id);
  return reportedIn(programModule(program, id).tree.source, diagnostics);
}

describe('where @Holds and @Keeps stand', () => {
  it('names only parameters the function has, each reported where it is spelled', () => {
    const text = lines(
      "import Keeps from 'lifetimes'",
      'extern shared struct Box<T>',
      '@Keeps{["self": ["nope"], "value": ["self", "nope"]]}',
      'extern ista fn stash<T>(self: Box<T>, value: T)',
    );
    expect(reportedInStd(text)).toEqual({
      codes: [5752, 5752],
      spanTexts: ['"nope"', '"nope"'],
    });
  });

  it('is only the std: neither annotates a program, even on an extern', () => {
    const text = lines(
      "import Holds, Keeps from 'lifetimes'",
      '@Holds<()>',
      'extern struct Handle<T>',
      '@Keeps{["x": ["y"]]}',
      'extern fn keep(x: Handle<Int>, y: Int)',
    );
    expect(reported(text).codes).toEqual([5750, 5751]);
  });

  it("is, for @Holds, only an extern struct, and for @Keeps any of the std's functions", () => {
    const text = lines(
      "import Holds, Keeps from 'lifetimes'",
      '@Holds<T>',
      'struct Box<T>:',
      '  item: T',
      '@Keeps{["x": ["x"]]}',
      'fn keep(x: Int): ()',
      '@Holds<Int>',
      'extern fn other()',
    );
    expect(reportedInStd(text).codes).toEqual([5750, 5903]);
  });

  it("is where the std's own externs have them", () => {
    expect(reportedInStd('')).toEqual(reportedNothing);
  });
});
