/**
 * Static lifetimes over one checker's program (design.md): no heap cycle may pass through what
 * reaches a disposable, so counting alone decides when one loses its last holder.
 *
 * - **Bottom up, by summaries** (design.md §5.3): a function's analysis reads the summaries of
 *   what it calls, never their bodies, and a requirement reaching a function's callers is checked
 *   by each call. A group of functions calling each other is solved together, from summaries that
 *   do nothing, until none changes: the lattice over a group's inputs is finite.
 * - **Entries, as the expansion graph keeps them** (design.md §8): what each function calls; each
 *   function's recursive group, found in what it reaches; each group's analyses; each
 *   function's summary, which an edit keeping its effects leaves equal, so its callers stop there;
 *   and each function's reports, the only entry reading where its findings are. Relevance and the
 *   handles a type may hold are entries per type.
 * - **Lazy:** a module's check reads the summaries of what its functions call, transitively, and
 *   nothing else.
 * - **Reported per module:** `check` reports each finding where it stands, through the
 *   `lifetime reports` entry (reports.ts); `findingsOf` lists them, for tests.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import { functionsOf, isFieldsFunction } from '../../../syntax/declarations/field-defaults.ts';
import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import { bodyOf } from '../../../syntax/tree/index.ts';
import type { LifetimeFinding, LifetimeQueries } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { type FunctionCall, functionCallsWithin } from '../../surface/resolved-call.ts';
import { substitutionOf } from '../../surface/witness-closing.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import { flowOf } from '../flow/build/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';
import type { AnalysisContext, Violation } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import {
  contextConstantFlow,
  Declared,
  defaultsFlows,
  flowInputsOf,
  withDefaults,
} from './declared.ts';
import { Dispatch } from './dispatch.ts';
import { type Call, groupOf, sameGroupSummaries } from './groups.ts';
import { diagnosticOf } from './reports.ts';
import {
  constructorSummary,
  emptySummary,
  nativeSummary,
  type Summary,
  sameSummary,
} from './summary.ts';
import {
  type HandleReach,
  handleReachOf,
  type Relevance,
  relevanceOf,
  sameHandleReach,
} from './type-reach.ts';

export class Lifetimes implements LifetimeQueries {
  readonly #checker: CheckerContext;
  readonly #natives: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #callees: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #groups: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #analyses: EntryTable<
    CheckerNote,
    FunctionDeclaration,
    ReadonlyMap<FunctionDeclaration, Analysis>
  >;
  readonly #summaries: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #constructors: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #context: AnalysisContext;
  readonly #declared: Declared;
  readonly #dispatch: Dispatch;
  readonly #reports: EntryTable<
    CheckerNote,
    FunctionDeclaration | ContextConstantDeclaration,
    void,
    ModuleId
  >;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#natives = checker.entries.table({
      name: 'native summaries',
      compute: (native: FunctionDeclaration) => nativeSummary(checker, native),
      equal: sameSummary,
    });
    this.#callees = checker.entries.table({
      name: 'lifetime callees',
      compute: (caller: FunctionDeclaration) => this.#calleesOf(caller),
      equal: sameItems(),
    });
    this.#groups = checker.entries.table({
      name: 'lifetime groups',
      compute: (declaration: FunctionDeclaration) => this.#groupFrom(declaration),
      equal: sameItems(),
    });
    this.#analyses = checker.entries.table({
      name: 'lifetime analyses',
      compute: (first: FunctionDeclaration) => this.#analyzeGroup(this.#groupOf(first)),
      // Reached again only through a default reaching its own function, an error found elsewhere.
      cyclic: { standIn: () => new Map() },
    });
    this.#summaries = checker.entries.table({
      name: 'lifetime summaries',
      compute: (declaration: FunctionDeclaration) => this.#analysisOf(declaration).summary,
      equal: sameSummary,
      cyclic: { standIn: () => emptySummary },
    });
    this.#constructors = checker.entries.table({
      name: 'constructor summaries',
      compute: (fields: FunctionDeclaration) =>
        withDefaults(constructorSummary(checker, fields), this.#declared.defaultsOf(fields)),
      equal: sameSummary,
      cyclic: { standIn: (fields) => constructorSummary(checker, fields) },
    });
    this.#declared = new Declared({
      checker,
      context: () => this.#context,
      analysisOf: (declaration) => this.#analysisOf(declaration),
      hasBody: (declaration) => this.#hasBody(declaration),
    });
    this.#dispatch = new Dispatch(checker, (module) => this.#flowsOf(module));
    this.#reports = checker.entries.table({
      name: 'lifetime reports',
      compute: (declaration: FunctionDeclaration | ContextConstantDeclaration, module: ModuleId) =>
        this.#report(declaration, module),
    });
    this.#context = {
      facts: typeFactsOf(checker),
      calleeSummary: (call) => this.#calleeSummary(call, undefined),
      parametersOf: (declaration) => checker.parametersOf(declaration),
      substitute: (type, call) => substitutedIn(checker, type, call),
      readsWhatItIterates: (iterate) => checker.isStd(checker.moduleOf(iterate)),
      dispatched: (call) => this.#dispatch.dispatched(call),
    };
  }

  /** Whether values of `type` may reach a disposable: what decides that the runtime counts them. */
  reachesDisposable(type: Type): boolean {
    return this.#context.facts.relevanceOf(type) !== 'no';
  }

  /** What the rule finds in `module`'s functions, in their order. */
  findingsOf(module: ModuleId): readonly LifetimeFinding[] {
    return this.#declarationsOf(module).flatMap((declaration) =>
      this.#violationsOf(declaration).map((violation) => ({ ...violation, declaration })),
    );
  }

  check(module: ModuleId): void {
    for (const declaration of this.#declarationsOf(module)) {
      this.#reports.get(declaration, module);
    }
  }

  #declarationsOf(module: ModuleId): readonly (FunctionDeclaration | ContextConstantDeclaration)[] {
    const items = this.#checker.inputs.itemsOf(module);
    return [
      ...functionsOf({ items }),
      ...items.filter(
        (item): item is ContextConstantDeclaration => item.kind === 'ContextConstantDeclaration',
      ),
    ];
  }

  #violationsOf(
    declaration: FunctionDeclaration | ContextConstantDeclaration,
  ): readonly Violation[] {
    return [
      ...(declaration.kind === 'FunctionDeclaration' && this.#hasBody(declaration)
        ? this.#analysisOf(declaration).violations
        : []),
      ...this.#declared.violationsOf(declaration),
    ];
  }

  /** Reports each of `declaration`'s violations, the callee or witness whose write it is beside. */
  #report(declaration: FunctionDeclaration | ContextConstantDeclaration, module: ModuleId): void {
    for (const violation of this.#violationsOf(declaration)) {
      this.#checker.report(module, diagnosticOf(this.#checker, violation));
    }
  }

  #ownFunctions(module: ModuleId): readonly FunctionDeclaration[] {
    const items = this.#checker.inputs.itemsOf(module);
    return functionsOf({ items }).filter((declaration) => this.#hasBody(declaration));
  }

  #hasBody(declaration: FunctionDeclaration): boolean {
    if (declaration.isExtern) {
      return false;
    }
    const module = this.#checker.moduleOf(declaration);
    return bodyOf(this.#checker.inputs.treeOf(module), declaration) !== undefined;
  }

  /** The functions `caller`'s body calls that have bodies, witnesses included. */
  #calleesOf(caller: FunctionDeclaration): readonly FunctionDeclaration[] {
    const calls = this.#checker.bodyOf(caller)?.madeCalls() ?? [];
    const callees = new Set(
      calls.flatMap(({ call }) => functionCallsWithin(call).map((each) => each.function)),
    );
    return [...callees].filter((callee) => this.#hasBody(callee));
  }

  /** The members of `declaration`'s recursive group, in the call graph it reaches. */
  #groupFrom(declaration: FunctionDeclaration): readonly FunctionDeclaration[] {
    const edges: Call[] = [];
    const seen = new Set<FunctionDeclaration>();
    const pending = [declaration];
    while (pending.length > 0) {
      const caller = pending.pop() as FunctionDeclaration;
      if (!seen.has(caller)) {
        seen.add(caller);
        const callees = this.#callees.get(caller);
        edges.push(...callees.map((callee) => ({ from: caller, to: callee })));
        pending.push(...callees);
      }
    }
    const position = (member: FunctionDeclaration) => {
      const declaring = this.#checker.moduleOf(member);
      return [String(declaring), this.#ownFunctions(declaring).indexOf(member)] as const;
    };
    return groupOf(edges, declaration, position);
  }

  /** The members of `declaration`'s recursive group, the first naming it; itself alone if none. */
  #groupOf(declaration: FunctionDeclaration): readonly FunctionDeclaration[] {
    return this.#groups.get(declaration);
  }

  #analysisOf(declaration: FunctionDeclaration): Analysis {
    const [first] = this.#groupOf(declaration) as [FunctionDeclaration];
    const found = this.#analyses.get(first).get(declaration);
    return found ?? { summary: emptySummary, violations: [], inputTypes: new Map() };
  }

  /** Analyses a group's members together, from summaries doing nothing, until none changes. */
  #analyzeGroup(
    members: readonly FunctionDeclaration[],
  ): ReadonlyMap<FunctionDeclaration, Analysis> {
    const [first] = members as [FunctionDeclaration];
    const recursive = members.length > 1 || this.#callees.get(first).includes(first);
    let current = new Map(members.map((member) => [member, emptySummary] as const));
    for (;;) {
      const analyses = this.#analyzeAll(members, current);
      const next = new Map(
        [...analyses].map(([member, { summary }]) => [member, summary] as const),
      );
      if (!recursive || sameGroupSummaries(current, next)) {
        return analyses;
      }
      current = next;
    }
  }

  #analyzeAll(
    members: readonly FunctionDeclaration[],
    guesses: ReadonlyMap<FunctionDeclaration, Summary>,
  ): ReadonlyMap<FunctionDeclaration, Analysis> {
    return new Map(members.map((member) => [member, this.#analyzeFunction(member, guesses)]));
  }

  #analyzeFunction(
    declaration: FunctionDeclaration,
    group: ReadonlyMap<FunctionDeclaration, Summary>,
  ): Analysis {
    const checker = this.#checker;
    const module = checker.moduleOf(declaration);
    const body = checker.bodyOf(declaration);
    const block = bodyOf(checker.inputs.treeOf(module), declaration);
    if (body === undefined || block === undefined) {
      return { summary: emptySummary, violations: [], inputTypes: new Map() };
    }
    const parameters = checker.parametersOf(declaration);
    const flow = this.#flowOf(declaration) as FlowFunction;
    const references = new Set(
      flow.parameters.filter((_, index) => parameters[index]?.reference === true),
    );
    const context: AnalysisContext = {
      ...this.#context,
      calleeSummary: (call) => this.#calleeSummary(call, group),
    };
    const found = analyze(context, flow, {
      isAsync: declaration.qualifiers.async !== undefined,
      references,
    });
    return {
      ...found,
      summary: withDefaults(found.summary, this.#declared.defaultsOf(declaration)),
    };
  }

  /** The flow of `declaration`'s body, if it has one. */
  #flowOf(declaration: FunctionDeclaration): FlowFunction | undefined {
    const checker = this.#checker;
    const module = checker.moduleOf(declaration);
    const body = checker.bodyOf(declaration);
    const block = bodyOf(checker.inputs.treeOf(module), declaration);
    return body === undefined || block === undefined
      ? undefined
      : flowOf(flowInputsOf(checker, module, body), block, checker.parametersOf(declaration));
  }

  /** Every flow `module`'s bodies have: its functions', their defaults', its context constants'. */
  #flowsOf(module: ModuleId): readonly FlowFunction[] {
    const items = this.#checker.inputs.itemsOf(module);
    const functions = functionsOf({ items });
    return [
      ...functions.flatMap((declaration) =>
        this.#hasBody(declaration) ? (this.#flowOf(declaration) ?? []) : [],
      ),
      ...functions.flatMap((declaration) => defaultsFlows(this.#checker, declaration)),
      ...items.flatMap((item) =>
        item.kind === 'ContextConstantDeclaration'
          ? [contextConstantFlow(this.#checker, item)]
          : [],
      ),
    ];
  }

  /** What `call`'s function does: a native's declaration, a group member's guess, a summary. */
  #calleeSummary(
    call: FunctionCall,
    group: ReadonlyMap<FunctionDeclaration, Summary> | undefined,
  ): Summary | undefined {
    const callee = call.function;
    if (callee.isExtern) {
      return this.#natives.get(callee);
    }
    const guess = group?.get(callee);
    if (guess !== undefined) {
      return guess;
    }
    if (this.#hasBody(callee)) {
      return this.#summaries.get(callee);
    }
    return isFieldsFunction(callee) ? this.#constructors.get(callee) : undefined;
  }
}

/** `type`, written in `call`'s function, as `call` instantiates it. */
function substitutedIn(checker: CheckerContext, type: Type, call: FunctionCall): Type {
  const substitution = substitutionOf({
    declaration: call.function,
    typeArguments: call.typeArguments,
  });
  return substitute(type, substitution, checker.typeRules);
}

/**
 * What the analysis reads of types, kept as entries per type: whether its values may reach a
 * disposable, and which handles they may hold; and its cell, and its fields' names.
 */
function typeFactsOf(checker: CheckerContext): AnalysisContext['facts'] {
  const relevance: EntryTable<CheckerNote, string, Relevance, Type> = checker.entries.table({
    name: 'lifetime relevance',
    compute: (_key: string, type: Type) => relevanceOf(checker, type),
  });
  const handles: EntryTable<CheckerNote, string, HandleReach, Type> = checker.entries.table({
    name: 'lifetime handles',
    compute: (_key: string, type: Type) => handleReachOf(checker, type),
    equal: sameHandleReach,
  });
  const typeKey = (type: Type) => checker.typeKeys.typeKey(type);
  return {
    relevanceOf: (type) => relevance.get(typeKey(type), type),
    reachOf: (type) => handles.get(typeKey(type), type),
    cellOf: (type) => checker.cellOf(type),
    fieldNamesOf: (type) => checker.fieldsOf(type)?.map(({ name }) => name),
    keyOf: typeKey,
  };
}
