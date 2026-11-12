/**
 * Static lifetimes over one checker's program (design.md): no heap cycle may pass through what
 * reaches a disposable, so counting alone decides when one loses its last holder.
 *
 * - **Bottom up, by summaries** (design.md §5.3): a function's analysis reads the summaries of
 *   what it calls, never their bodies, and a requirement reaching a function's callers is checked
 *   by each call. A group of functions calling each other is solved together, from summaries that
 *   do nothing, until none changes: the lattice over a group's inputs is finite.
 * - **Entries, as the expansion graph keeps them** (design.md §8): what each function calls; per
 *   module, the recursive groups what its functions call fall into; each group's analyses; each
 *   function's summary, which an edit keeping its effects leaves equal, so its callers stop there;
 *   and each function's reports, the only entry reading where its findings are. Relevance and the
 *   handles a type may hold are entries per type.
 * - **Lazy:** a module's check reads the summaries of what its functions call, transitively, and
 *   nothing else.
 * - **Dry until switched on** (plan C3): `findingsOf` lists what the rule would report; `check`
 *   reports only once the rule is on.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import { stronglyConnected } from '../../../../foundation/structures/strongly-connected.ts';
import type { ModuleId } from '../../../program/program.ts';
import { functionsOf, isFieldsFunction } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { bodyOf } from '../../../syntax/tree/index.ts';
import type { LifetimeFinding, LifetimeQueries } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { type FunctionCall, functionCallsWithin } from '../../surface/resolved-call.ts';
import { substitutionOf } from '../../surface/witness-closing.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import { flowOf } from '../flow/build/index.ts';
import type { AnalysisContext } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
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

type Groups = ReadonlyMap<FunctionDeclaration, readonly FunctionDeclaration[]>;

export class Lifetimes implements LifetimeQueries {
  readonly #checker: CheckerContext;
  readonly #relevance: EntryTable<CheckerNote, string, Relevance, Type>;
  readonly #handles: EntryTable<CheckerNote, string, HandleReach, Type>;
  readonly #natives: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #callees: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #groups: EntryTable<CheckerNote, ModuleId, Groups>;
  readonly #analyses: EntryTable<
    CheckerNote,
    FunctionDeclaration,
    ReadonlyMap<FunctionDeclaration, Analysis>
  >;
  readonly #summaries: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #constructors: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #context: AnalysisContext;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#relevance = checker.entries.table({
      name: 'lifetime relevance',
      compute: (_key: string, type: Type) => relevanceOf(checker, type),
    });
    this.#handles = checker.entries.table({
      name: 'lifetime handles',
      compute: (_key: string, type: Type) => handleReachOf(checker, type),
      equal: sameHandleReach,
    });
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
      compute: (module: ModuleId) => this.#groupsFrom(module),
      equal: sameGroups,
    });
    this.#analyses = checker.entries.table({
      name: 'lifetime analyses',
      compute: (first: FunctionDeclaration) => this.#analyzeGroup(this.#groupOf(first)),
    });
    this.#summaries = checker.entries.table({
      name: 'lifetime summaries',
      compute: (declaration: FunctionDeclaration) => this.#analysisOf(declaration).summary,
      equal: sameSummary,
    });
    this.#constructors = checker.entries.table({
      name: 'constructor summaries',
      compute: (fields: FunctionDeclaration) => constructorSummary(checker, fields),
      equal: sameSummary,
    });
    const typeKey = (type: Type) => checker.typeKeys.typeKey(type);
    this.#context = {
      facts: {
        relevanceOf: (type) => this.#relevance.get(typeKey(type), type),
        reachOf: (type) => this.#handles.get(typeKey(type), type),
        cellOf: (type) => checker.cellOf(type),
        fieldNamesOf: (type) => checker.fieldsOf(type)?.map(({ name }) => name),
        keyOf: typeKey,
      },
      calleeSummary: (call) => this.#calleeSummary(call, undefined),
      parametersOf: (declaration) => checker.parametersOf(declaration),
      substitute: (type, call) => substitutedIn(checker, type, call),
      readsWhatItIterates: (iterate) => checker.isStd(checker.moduleOf(iterate)),
    };
  }

  /** Whether values of `type` may reach a disposable: what decides that the runtime counts them. */
  reachesDisposable(type: Type): boolean {
    return this.#context.facts.relevanceOf(type) !== 'no';
  }

  /** What the rule finds in `module`'s functions, in their order. */
  findingsOf(module: ModuleId): readonly LifetimeFinding[] {
    return this.#ownFunctions(module).flatMap((declaration) =>
      this.#analysisOf(declaration).violations.map((violation) => ({
        ...violation,
        function: declaration,
      })),
    );
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

  /** The recursive groups of the functions `module`'s functions call, each listing its members. */
  #groupsFrom(module: ModuleId): Groups {
    const edges: Call[] = [];
    const seen = new Set<FunctionDeclaration>();
    const pending = [...this.#ownFunctions(module)];
    while (pending.length > 0) {
      const caller = pending.pop() as FunctionDeclaration;
      if (!seen.has(caller)) {
        seen.add(caller);
        const callees = this.#callees.get(caller);
        edges.push(...callees.map((callee) => ({ from: caller, to: callee })));
        pending.push(...callees);
      }
    }
    const position = (declaration: FunctionDeclaration) => {
      const declaring = this.#checker.moduleOf(declaration);
      return [String(declaring), this.#ownFunctions(declaring).indexOf(declaration)] as const;
    };
    return groupsOf(edges, position);
  }

  /** The members of `declaration`'s recursive group, the first naming it; itself alone if none. */
  #groupOf(declaration: FunctionDeclaration): readonly FunctionDeclaration[] {
    return this.#groups.get(this.#checker.moduleOf(declaration)).get(declaration) ?? [declaration];
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
    const inputs = {
      checker,
      module,
      localBodyOf: (local: FunctionDeclaration) => checker.inputs.bodyOf(module, local),
      body,
    };
    const flow = flowOf(inputs, block, parameters);
    const references = new Set(
      flow.parameters.filter((_, index) => parameters[index]?.reference === true),
    );
    const context: AnalysisContext = {
      ...this.#context,
      calleeSummary: (call) => this.#calleeSummary(call, group),
    };
    return analyze(context, flow, {
      isAsync: declaration.qualifiers.async !== undefined,
      references,
    });
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

/** A call between two functions with bodies: an edge of the call graph. */
interface Call {
  readonly from: FunctionDeclaration;
  readonly to: FunctionDeclaration;
}

/**
 * The recursive groups of the call graph `edges`: each member's group, ordered by where its
 * members are declared (`position`), so every module's exploration names it alike.
 */
function groupsOf(
  edges: readonly Call[],
  position: (declaration: FunctionDeclaration) => readonly [string, number],
): Groups {
  const componentOf = stronglyConnected(edges);
  const members = new Map<FunctionDeclaration, Set<FunctionDeclaration>>();
  for (const { from, to } of edges) {
    const component = componentOf(from);
    if (component !== undefined && component === componentOf(to)) {
      const group = members.get(component) ?? new Set();
      group.add(from).add(to);
      members.set(component, group);
    }
  }
  const before = (first: FunctionDeclaration, second: FunctionDeclaration) => {
    const [firstModule, firstAt] = position(first);
    const [secondModule, secondAt] = position(second);
    return firstModule.localeCompare(secondModule) || firstAt - secondAt;
  };
  const groups = new Map<FunctionDeclaration, readonly FunctionDeclaration[]>();
  for (const group of members.values()) {
    const ordered = [...group].sort(before);
    for (const each of ordered) {
      groups.set(each, ordered);
    }
  }
  return groups;
}

function sameGroupSummaries(
  first: ReadonlyMap<FunctionDeclaration, Summary>,
  second: ReadonlyMap<FunctionDeclaration, Summary>,
): boolean {
  return [...first].every(([member, summary]) => {
    const other = second.get(member);
    return other !== undefined && sameSummary(summary, other);
  });
}

function sameGroups(first: Groups, second: Groups): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const [declaration, members] of first) {
    const other = second.get(declaration);
    if (other === undefined || !sameItems()(members, other)) {
      return false;
    }
  }
  return true;
}
