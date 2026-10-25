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
import type { CheckedBody, Checker } from '../checker/check.ts';
import { substitute } from '../checker/types/type.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { FunctionLowering, instanceFrame, nestedFrame } from './function-lowering.ts';
import {
  type BodyOwner,
  type FunctionInstance,
  instantiatedBody,
  type NestedInstance,
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
    const entry =
      next.kind === 'instance'
        ? entryOf(checker, tables, next.instance)
        : nestedEntryOf(checker, tables, next.nested);
    tables.define(next.index, entry);
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
  const body = checkedBodyOf(checker, instance);
  if (body !== undefined) {
    const owner = { kind: 'function', instance } as const;
    const lowered = { checker, tables, owner, body: instantiatedBody(body, instance) };
    const lowering = new FunctionLowering(lowered, instanceFrame(checker, tables, instance));
    if (instance.arity < parameters.length) {
      return lowering.lowerDefaults(instance);
    }
    if (declaration.body !== undefined) {
      return lowering.lower(declaration.body);
    }
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

/** The code entry of a lambda or local function, read through its owner's body (§3.14). */
function nestedEntryOf(
  checker: Checker,
  tables: DefinitionTables,
  nested: NestedInstance,
): FunctionDefinition {
  const { owner, node } = nested;
  const body = ownerBodyOf(checker, owner);
  if (body === undefined) {
    throw new Error(`The function at ${node.span.start} has no checked body holding it.`);
  }
  const frame = nestedFrame(tables, nested, body);
  return new FunctionLowering({ checker, tables, owner, body }, frame).lowerNested(node);
}

/** The body holding `owner`'s nested functions: its instance's, read through it, or the constant's. */
function ownerBodyOf(checker: Checker, owner: BodyOwner): CheckedBody | undefined {
  if (owner.kind === 'constant') {
    return checker.constantBodyOf(owner.declaration);
  }
  const body = checkedBodyOf(checker, owner.instance);
  return body === undefined ? undefined : instantiatedBody(body, owner.instance);
}

/**
 * The checked body an instance's code reads: its defaults' for an entry its callers leave
 * parameters of to their defaults (§3.3), else its own; undefined for an extern.
 */
function checkedBodyOf(checker: Checker, instance: FunctionInstance): CheckedBody | undefined {
  const { declaration, arity } = instance;
  return arity < checker.parametersOf(declaration).length
    ? checker.defaultsOf(declaration)
    : checker.bodyOf(declaration);
}
