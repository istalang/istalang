/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main`, or from a test program's suites (§10), and compiles every function
 * instance it reaches, through a worklist (tables/tables.ts, tables/instances.ts): a function with
 * a body becomes code, an extern an entry bound to its native by key, and a call leaving parameters
 * to their defaults an entry computing them. Lowering runs only on a program the checker accepted,
 * so it reports nothing; anything it can't lower is a bug in an earlier phase and throws.
 */

import type { Definition } from '../../definition/definition.ts';
import type { FunctionDefinition } from '../../definition/tables/functions.ts';
import { languageModules } from '../../foundation/language/well-known/index.ts';
import { testingFunctions } from '../../foundation/language/well-known/testing.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import { isHostExtern } from '../checker/surface/host-externs.ts';
import { substitute } from '../checker/types/parts/substitution.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { writtenBodyOf } from './functions/bodies.ts';
import { asyncFitEntry } from './functions/fits.ts';
import { instanceLowering, nestedLowering } from './functions/index.ts';
import { derivedCodecDirection, derivedCodecEntry } from './synthesized/boundary/codecs.ts';
import {
  constantNativeEntry,
  hostConstantEntry,
  hostFunctionEntry,
  hostNativeEntry,
} from './synthesized/boundary/host-externs.ts';
import { listStart, startableOf, startables, startEntry } from './synthesized/boundary/starts.ts';
import { anyConversionEntry, anyFieldEntry, dispatchEntry } from './synthesized/trait-objects.ts';
import { fillingEntry } from './tables/filling-entry.ts';
import {
  type FunctionInstance,
  type NestedInstance,
  rootInstance,
  substitutionOf,
} from './tables/instances.ts';
import { keyOf } from './tables/names.ts';
import { type ClosingEntry, DefinitionTables, type PendingEntry } from './tables/tables.ts';

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
  const lowering = { checker, tables };
  const mainIndex = listStart(lowering, started);
  for (const startable of startables(checker)) {
    listStart(lowering, startable);
  }
  lowerReached(checker, tables);
  return tables.finish(mainIndex);
}

/** A `@Suite` function (§10), with the title its annotation gives. */
export interface Suite {
  readonly title: string;
  readonly declaration: FunctionDeclaration;
}

/**
 * The Definition of a program's tests (§10): everything its `suites` and the testing module's
 * listing and running of their tests reach, which every test's instance starts from.
 */
export function lowerTests(checker: Checker, suites: readonly Suite[]): Definition {
  const tables = new DefinitionTables(checker);
  const indexOf = (declaration: FunctionDeclaration) =>
    tables.functionIndex(rootInstance(declaration));
  const runner = (name: string) =>
    checker.languageFunctions(languageModules.testing, name)[0] ??
    unreachable(`The testing module declares no '${name}'.`);
  const tests = {
    list: indexOf(runner(testingFunctions.list)),
    run: indexOf(runner(testingFunctions.run)),
    suites: suites.map(({ title, declaration }) => ({ title, function: indexOf(declaration) })),
  };
  lowerReached(checker, tables);
  return { ...tables.finish(undefined), tests };
}

/** Lowers every entry referenced so far, and every entry those reference. */
function lowerReached(checker: Checker, tables: DefinitionTables): void {
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    tables.define(next.index, pendingEntry(checker, tables, next));
  }
}

/** The entry `pending` stands for. */
function pendingEntry(
  checker: Checker,
  tables: DefinitionTables,
  pending: PendingEntry | ClosingEntry,
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
    case 'dispatch':
      return dispatchEntry(lowering, pending.dispatch);
    case 'anyConversion':
      return anyConversionEntry(lowering, pending.from, pending.to);
    case 'anyField':
      return anyFieldEntry(lowering, pending.on, pending.required);
    case 'asyncFit':
      return asyncFitEntry(lowering, pending.fit);
    default: {
      const unhandled: never = pending;
      return unhandled;
    }
  }
}

/**
 * The entry for `instance`: a filling entry, or one giving a parameter its default
 * (tables/instances.ts, §3.3); else its function's own: code for a function with a body, or an
 * extern bound to its native.
 */
function entryOf(
  checker: Checker,
  tables: DefinitionTables,
  instance: FunctionInstance,
): FunctionDefinition {
  const { declaration, entry } = instance;
  if (entry.kind === 'filling') {
    return fillingEntry({ checker, tables }, instance, entry.binding);
  }
  if (entry.kind === 'default') {
    return defaultEntry(checker, tables, instance);
  }
  const codecDirection = derivedCodecDirection(checker, instance);
  if (codecDirection !== undefined) {
    return derivedCodecEntry({ checker, tables, instance }, codecDirection);
  }
  if (isHostExtern(checker, declaration)) {
    return hostFunctionEntry({ checker, tables }, instance);
  }
  const parameters = checker.parametersOf(declaration);
  const lowering = instanceLowering({ checker, tables }, instance);
  const body = writtenBodyOf(checker.program, checker.moduleOf(declaration), declaration);
  if (lowering !== undefined && body !== undefined) {
    return lowering.lower(body);
  }
  const substitution = substitutionOf(instance);
  return {
    kind: 'extern',
    ...tables.entryHeader(instance),
    key: keyOf(checker, declaration, parameters),
    constant: false,
    parameters: parameters.map((parameter) => ({
      type: tables.types.reference(substitute(parameter.type, substitution, checker.typeRules)),
      reference: parameter.reference,
    })),
    result: tables.types.reference(
      substitute(checker.resultOf(declaration), substitution, checker.typeRules),
    ),
    typeArguments: instance.typeArguments.map((type) => tables.types.reference(type)),
  };
}

/** The entry giving one parameter of `instance`'s function its default (§3.1, §3.3). */
function defaultEntry(
  checker: Checker,
  tables: DefinitionTables,
  instance: FunctionInstance,
): FunctionDefinition {
  const lowering = instanceLowering({ checker, tables }, instance);
  if (lowering === undefined) {
    unreachable(`${instance.declaration.name.text} has no defaults to compute.`);
  }
  return lowering.lowerDefault(instance);
}

/** The code entry of a lambda or local function, read through its owner's body (§3.14). */
function nestedEntryOf(
  checker: Checker,
  tables: DefinitionTables,
  nested: NestedInstance,
): FunctionDefinition {
  return nestedLowering({ checker, tables }, nested).lowerNested(nested.node);
}
