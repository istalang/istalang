/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main` and compiles every function it reaches, through a worklist
 * (tables.ts): a function with a body becomes code, an extern an entry bound to its native by key.
 * Lowering runs only on a program the checker accepted, so it reports nothing; anything it can't
 * lower is a bug in an earlier phase and throws.
 */

import type { Definition } from '../../definition/definition.ts';
import type { FunctionDefinition } from '../../definition/functions.ts';
import type { Checker } from '../checker/check.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { FunctionLowering } from './function-lowering.ts';
import { externKeyOf } from './names.ts';
import { DefinitionTables } from './tables.ts';

/** The Definition of everything `main` reaches. */
export function lower(checker: Checker, main: FunctionDeclaration): Definition {
  const tables = new DefinitionTables(checker);
  const mainIndex = tables.functionIndex(main);
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    tables.define(next.index, entryOf(checker, tables, next.declaration));
  }
  return tables.finish(mainIndex);
}

function entryOf(
  checker: Checker,
  tables: DefinitionTables,
  declaration: FunctionDeclaration,
): FunctionDefinition {
  const module = checker.moduleOf(declaration);
  const body = checker.bodyOf(declaration);
  if (declaration.body !== undefined && body !== undefined) {
    return new FunctionLowering(checker, tables, module, body).lower(declaration, declaration.body);
  }
  return {
    kind: 'extern',
    ...tables.entryHeader(declaration),
    key: externKeyOf(checker, declaration),
    constant: false,
    parameters: checker.parametersOf(declaration).map((parameter) => ({
      type: tables.typeReference(parameter.type),
      reference: parameter.reference,
    })),
    result: tables.typeReference(checker.resultOf(declaration)),
    typeArguments: [],
  };
}
