/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main` and compiles every function instance it reaches, through a worklist
 * (tables.ts, instances.ts): a function with a body becomes code, an extern an entry bound to its
 * native by key, and a call leaving parameters to their defaults an entry computing them.
 * Lowering runs only on a program the checker accepted, so it reports nothing; anything it can't
 * lower is a bug in an earlier phase and throws.
 */

import type { Definition } from '../../definition/definition.ts';
import type { FunctionDefinition } from '../../definition/functions.ts';
import type { Checker } from '../checker/check.ts';
import { substitute } from '../checker/types/type.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { FunctionLowering } from './function-lowering.ts';
import {
  type FunctionInstance,
  instantiatedBody,
  rootInstance,
  substitutionOf,
} from './instances.ts';
import { externKeyOf } from './names.ts';
import { DefinitionTables } from './tables.ts';

/** The Definition of everything `main` reaches. */
export function lower(checker: Checker, main: FunctionDeclaration): Definition {
  const tables = new DefinitionTables(checker);
  const mainIndex = tables.functionIndex(rootInstance(checker, main));
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    tables.define(next.index, entryOf(checker, tables, next.instance));
  }
  return tables.finish(mainIndex);
}

/**
 * The entry for `instance`: a defaults entry when its callers leave parameters to their defaults
 * (§3.3), code for a function with a body, or an extern bound to its native.
 */
function entryOf(
  checker: Checker,
  tables: DefinitionTables,
  instance: FunctionInstance,
): FunctionDefinition {
  const { declaration } = instance;
  const parameters = checker.parametersOf(declaration);
  const defaults = checker.defaultsOf(declaration);
  if (instance.arity < parameters.length && defaults !== undefined) {
    const body = instantiatedBody(defaults, instance);
    return new FunctionLowering(checker, tables, instance, body).lowerDefaults();
  }
  const body = checker.bodyOf(declaration);
  if (declaration.body !== undefined && body !== undefined) {
    const instantiated = instantiatedBody(body, instance);
    return new FunctionLowering(checker, tables, instance, instantiated).lower(declaration.body);
  }
  const substitution = substitutionOf(instance);
  return {
    kind: 'extern',
    ...tables.entryHeader(instance),
    key: externKeyOf(checker, declaration),
    constant: false,
    parameters: parameters.map((parameter) => ({
      type: tables.typeReference(substitute(parameter.type, substitution)),
      reference: parameter.reference,
    })),
    result: tables.typeReference(substitute(checker.resultOf(declaration), substitution)),
    typeArguments: instance.typeArguments.map((type) => tables.typeReference(type)),
  };
}
