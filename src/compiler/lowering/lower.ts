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
import { unreachable } from '../../structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import { isHostExtern } from '../checker/host-externs.ts';
import { substitute } from '../checker/types/type.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { isFieldsFunction } from '../syntax/field-defaults.ts';
import { derivedCodecEntry, isDerivedCodec } from './boundary/codecs.ts';
import {
  constantNativeEntry,
  hostConstantEntry,
  hostFunctionEntry,
  hostNativeEntry,
} from './boundary/host-externs.ts';
import { startableOf, startables, startEntry } from './boundary/starts.ts';
import { instanceLowering, nestedLowering } from './function-lowering/index.ts';
import { type FunctionInstance, type NestedInstance, substitutionOf } from './instances.ts';
import { keyOf } from './names.ts';
import { DefinitionTables, type PendingEntry } from './tables.ts';

/**
 * The Definition of everything `main` and the program's startable functions reach (§9): `main` is
 * started through its start entry, as a host starts any of the others.
 */
export function lower(checker: Checker, main: FunctionDeclaration): Definition {
  const tables = new DefinitionTables(checker);
  const started = startableOf(checker, main);
  if (started === undefined) {
    unreachable("'main' can't be started; the checker should have said why.");
  }
  const mainIndex = tables.startIndex(main, started.key);
  for (const startable of startables(checker)) {
    tables.startIndex(startable.target, startable.key);
  }
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    tables.define(next.index, pendingEntry(checker, tables, next));
  }
  return tables.finish(mainIndex);
}

/** The entry `pending` stands for. */
function pendingEntry(
  checker: Checker,
  tables: DefinitionTables,
  pending: PendingEntry,
): FunctionDefinition {
  const lowering = { checker, tables };
  switch (pending.kind) {
    case 'instance':
      return entryOf(checker, tables, pending.instance);
    case 'nested':
      return nestedEntryOf(checker, tables, pending.nested);
    case 'hostNative':
      return hostNativeEntry(lowering, pending.declaration);
    case 'constantNative':
      return constantNativeEntry(lowering, pending.declaration, pending.type);
    case 'externConstant':
      return hostConstantEntry(lowering, pending.declaration, pending.type);
    case 'start': {
      const startable = startableOf(checker, pending.target);
      if (startable === undefined) {
        unreachable('A start entry was made for what no host can start.');
      }
      return startEntry(lowering, startable);
    }
    default: {
      const unhandled: never = pending;
      return unhandled;
    }
  }
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
  if (isDerivedCodec(checker, instance)) {
    return derivedCodecEntry({ checker, tables, instance });
  }
  if (isHostExtern(checker, declaration)) {
    return hostFunctionEntry({ checker, tables }, instance);
  }
  const parameters = checker.parametersOf(declaration);
  const lowering = instanceLowering({ checker, tables }, instance);
  if (lowering !== undefined) {
    if (isFieldsFunction(declaration)) {
      return lowering.lowerFieldDefault(instance);
    }
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
    key: keyOf(checker, declaration, parameters),
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
  return nestedLowering({ checker, tables }, nested).lowerNested(nested.node);
}
