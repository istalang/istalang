/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main`, or from a test program's suites (§10), and compiles every function
 * instance it reaches, through a worklist (tables/tables.ts, tables/instances.ts), and the runtime's
 * loop serving jobs once it reaches `delegate` (§5), as the program's job server: a function with
 * a body becomes code computing the defaults its call leaves out before its body, a struct's or a
 * variant's fields code building it, and an extern an entry bound to its native by key, beside code
 * computing its defaults for a call leaving them out. Lowering runs only on a program the checker
 * accepted, so it reports nothing; anything it can't lower is a bug in an earlier phase and throws.
 */

import type { Definition } from '../../definition/definition.ts';
import type { FunctionId } from '../../definition/operands.ts';
import type { FunctionDefinition } from '../../definition/tables/functions.ts';
import { languageModules, runtimeModule } from '../../foundation/language/well-known/index.ts';
import { jobFunctions } from '../../foundation/language/well-known/jobs.ts';
import { testingFunctions } from '../../foundation/language/well-known/testing.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import { type FunctionInstance, substitutionOf } from '../checker/surface/witness-closing.ts';
import { substitute } from '../checker/types/parts/substitution.ts';
import { stdModuleIdOf } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { deferredEntry } from './constructs/expressions/deferred-calls.ts';
import { writtenBodyOf } from './functions/bodies.ts';
import {
  constructorEntry,
  externDefaultsEntry,
  hostExternEntry,
  structEntry,
} from './functions/built-entries.ts';
import { asyncFitEntry, convertingEntry, wrappingEntry } from './functions/fits/index.ts';
import type { Lowering } from './functions/frames.ts';
import { accessorLowering, instanceLowering, nestedLowering } from './functions/index.ts';
import { derivedCodecEntry } from './synthesized/boundary/codecs.ts';
import {
  constantNativeEntry,
  hostConstantEntry,
  hostNativeEntry,
} from './synthesized/boundary/host-externs.ts';
import { listStart, startableOf, startables, startEntry } from './synthesized/boundary/starts.ts';
import { anyConversionEntry, anyFieldEntry, dispatchEntry } from './synthesized/trait-objects.ts';
import { rootInstance } from './tables/instances.ts';
import { keyOf, qualifiedNameOf } from './tables/names.ts';
import { ownEntryOf } from './tables/own-entries.ts';
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
  return tables.finish(mainIndex, lowerReached(checker, tables));
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
    tables.functionIndex(rootInstance(checker, declaration));
  const runner = (name: string) =>
    checker.languageFunctions(languageModules.testing, name)[0] ??
    unreachable(`The testing module declares no '${name}'.`);
  const tests = {
    list: indexOf(runner(testingFunctions.list)),
    run: indexOf(runner(testingFunctions.run)),
    suites: suites.map(({ title, declaration }) => ({ title, function: indexOf(declaration) })),
  };
  return { ...tables.finish(undefined, lowerReached(checker, tables)), tests };
}

/**
 * Lowers every entry referenced so far, and every entry those reference; the index of the job
 * server, lowered with them once one is an instance of `delegate`.
 */
function lowerReached(checker: Checker, tables: DefinitionTables): FunctionId | undefined {
  const jobs = jobDeclarationsOf(checker);
  let jobServer: FunctionId | undefined;
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    const delegates = next.kind === 'instance' && next.instance.declaration === jobs?.delegate;
    if (delegates && jobs !== undefined && jobServer === undefined) {
      jobServer = tables.functionIndex(rootInstance(checker, jobs.server));
    }
    tables.define(next.index, pendingEntry(checker, tables, next));
  }
  return jobServer;
}

/** The runtime module's `delegate` and the job server serving what it queues; none without it. */
function jobDeclarationsOf(
  checker: Checker,
): { readonly delegate: FunctionDeclaration; readonly server: FunctionDeclaration } | undefined {
  const runtime = stdModuleIdOf(runtimeModule);
  if (!checker.program.modules.has(runtime)) {
    return undefined;
  }
  const declared = (name: string): FunctionDeclaration =>
    checker.topLevelFunctions(runtime, name)[0] ??
    unreachable(`The runtime module declares no '${name}'.`);
  return { delegate: declared(jobFunctions.delegate), server: declared(jobFunctions.server) };
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
    case 'externDefaults':
      return externDefaultsEntry(lowering, pending.instance);
    case 'nested':
      return nestedLowering(lowering, pending.nested).lowerNested(pending.nested.node);
    case 'hostNative':
      return hostNativeEntry(lowering, pending.declaration);
    case 'constantNative':
      return constantNativeEntry(lowering, pending.declaration, pending.type);
    case 'externConstant':
      return hostConstantEntry(lowering, pending.declaration, pending.type);
    case 'contextConstant':
      return accessorLowering(lowering, pending.declaration).lowerAccessor(
        pending.declaration,
        qualifiedNameOf(checker, pending.declaration),
      );
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
    case 'deferred':
      return deferredEntry(lowering, pending.deferred);
    case 'converting':
      return convertingEntry(lowering, pending);
    case 'wrapping':
      return wrappingEntry(lowering, pending);
    default: {
      const unhandled: never = pending;
      return unhandled;
    }
  }
}

/** The entry for `instance`, made of what its own entry is (tables/own-entries.ts). */
function entryOf(
  checker: Checker,
  tables: DefinitionTables,
  instance: FunctionInstance,
): FunctionDefinition {
  const lowering = { checker, tables };
  const own = ownEntryOf(checker, instance);
  switch (own.kind) {
    case 'struct':
      return structEntry(lowering, instance);
    case 'constructor':
      return constructorEntry(lowering, instance);
    case 'derivedCodec':
      return derivedCodecEntry({ ...lowering, instance }, own.direction);
    case 'hostExtern':
      return hostExternEntry(lowering, instance);
    case 'body':
      return bodyEntry(lowering, instance);
    case 'native':
      return nativeEntry(lowering, instance);
    default: {
      const unhandled: never = own;
      return unhandled;
    }
  }
}

/** The code of `instance`'s function, its body. */
function bodyEntry(lowering: Lowering, instance: FunctionInstance): FunctionDefinition {
  const { checker } = lowering;
  const { declaration } = instance;
  const lowered = instanceLowering(lowering, instance);
  const body = writtenBodyOf(checker.program, checker.moduleOf(declaration), declaration);
  if (lowered === undefined || body === undefined) {
    unreachable(`${declaration.name.text} has no body to lower.`);
  }
  return lowered.lower(body);
}

/** The entry binding `instance`, an extern, to its native by key, with its instance's types. */
function nativeEntry(lowering: Lowering, instance: FunctionInstance): FunctionDefinition {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const parameters = checker.parametersOf(declaration);
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
