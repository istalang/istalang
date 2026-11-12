/**
 * Static lifetimes over one checker's program (design.md): no heap cycle may pass through what
 * reaches a disposable, so counting alone decides when one loses its last holder.
 *
 * - **Bottom up, by summaries** (design.md §5.3): a function's analysis reads the summaries of
 *   what it calls, never their bodies, and a requirement reaching a function's callers is checked
 *   by each call. A group of functions calling each other is solved together, from summaries that
 *   do nothing, until none changes: the lattice over a group's inputs is finite.
 * - **Entries, as the expansion graph keeps them** (design.md §8): each function's flow; what it
 *   calls; its recursive group, found in what it reaches; each group's analyses; each function's
 *   summary, which an edit keeping its effects leaves equal, so its callers stop there; and each
 *   function's reports, the only entry reading where its findings are. Relevance and the handles a
 *   type may hold are entries per type.
 * - **A caller reads of a callee its summary alone,** one entry per call: whether the callee has a
 *   body is read off its declaration, never off the body, which every edit inside it makes anew.
 *   Each revision validates every entry a module's check reaches, so an entry earns its place only
 *   by cutting work off (tracker P49).
 * - **Lazy:** a module's check reads the summaries of what its functions call, transitively, and
 *   nothing else.
 * - **Reported per module:** `check` reports each finding where it stands, through the
 *   `lifetime reports` entry (reports.ts); `findingsOf` lists them, for tests.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import { edgesReachedFrom } from '../../../../foundation/structures/reachable.ts';
import type { ModuleId } from '../../../program/program.ts';
import { functionsOf, isFieldsFunction } from '../../../syntax/declarations/field-defaults.ts';
import type {
  ConstantDeclaration,
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { FindingDeclaration, LifetimeFinding, LifetimeQueries } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { type FunctionCall, functionCallsWithin } from '../../surface/resolved-call.ts';
import { substitutionOf } from '../../surface/witness-closing.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import { flowsBuiltFor } from '../flow/build/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';
import type { AnalysisContext, Violation } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import { constantFlow, Declared, defaultsFlows, withDefaults } from './declared.ts';
import { Dispatch } from './dispatch.ts';
import { typeFactsOf } from './facts.ts';
import { type Call, groupOf, sameGroupSummaries } from './groups.ts';
import { diagnosticOf } from './reports.ts';
import {
  constructorSummary,
  emptySummary,
  nativeSummary,
  type Summary,
  sameSummary,
} from './summary.ts';

export class Lifetimes implements LifetimeQueries {
  readonly #checker: CheckerContext;
  readonly #callees: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #groups: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #analyses: EntryTable<
    CheckerNote,
    FunctionDeclaration,
    ReadonlyMap<FunctionDeclaration, Analysis>
  >;
  readonly #summaries: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #context: AnalysisContext;
  readonly #declared: Declared;
  readonly #dispatch: Dispatch;
  readonly #reports: EntryTable<CheckerNote, FindingDeclaration, void, ModuleId>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
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
      compute: (declaration: FunctionDeclaration) => this.#summaryOf(declaration),
      equal: sameSummary,
      // A fields function's defaults reaching it again build its value as it stands.
      cyclic: {
        standIn: (declaration) =>
          isFieldsFunction(declaration) ? constructorSummary(checker, declaration) : emptySummary,
      },
    });
    this.#declared = new Declared({
      checker,
      context: () => this.#context,
      analysisOf: (declaration) => this.#analysisOf(declaration),
      hasBody,
    });
    this.#dispatch = new Dispatch(checker, (module) => this.#flowsOf(module));
    this.#reports = checker.entries.table({
      name: 'lifetime reports',
      compute: (declaration: FindingDeclaration, module: ModuleId) =>
        this.#report(declaration, module),
    });
    this.#context = this.#contextOf(checker);
  }

  /** What every function's analysis reads of the program through this rule. */
  #contextOf(checker: CheckerContext): AnalysisContext {
    return {
      facts: typeFactsOf(checker),
      calleeSummary: (call) => this.#calleeSummary(call, undefined),
      parametersOf: (declaration) => checker.parametersOf(declaration),
      defaultResult: (declaration, index) =>
        this.#declared.defaultsOf(declaration).results.get(index) ?? [],
      substitute: (type, call) => substitutedIn(checker, type, call),
      readsWhatItIterates: (iterate) => checker.isStd(checker.moduleOf(iterate)),
      witnessesOf: (call) => this.#dispatch.witnessesOf(call),
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

  #declarationsOf(module: ModuleId): readonly FindingDeclaration[] {
    const items = this.#checker.inputs.itemsOf(module);
    return [...functionsOf({ items }), ...constantsOf(items)];
  }

  /** What `declaration` violates: in its body, and where it stands; each site's once. */
  #violationsOf(declaration: FindingDeclaration): readonly Violation[] {
    const keyOf = (type: Type) => this.#checker.typeKeys.typeKey(type);
    const found = new Map<NodeOf<string>, Map<string, Violation>>();
    for (const violation of [
      ...(declaration.kind === 'FunctionDeclaration' && hasBody(declaration)
        ? this.#analysisOf(declaration).violations
        : []),
      ...this.#declared.violationsOf(declaration),
    ]) {
      const at = found.get(violation.site) ?? new Map<string, Violation>();
      found.set(
        violation.site,
        at.set(`${violation.kind}:${keyOf(violation.holderType)}`, violation),
      );
    }
    return [...found.values()].flatMap((at) => [...at.values()]);
  }

  /** Reports each of `declaration`'s violations, the callee or witness whose write it is beside. */
  #report(declaration: FindingDeclaration, module: ModuleId): void {
    for (const violation of this.#violationsOf(declaration)) {
      this.#checker.report(module, diagnosticOf(this.#checker, violation));
    }
  }

  #ownFunctions(module: ModuleId): readonly FunctionDeclaration[] {
    const items = this.#checker.inputs.itemsOf(module);
    return functionsOf({ items }).filter((declaration) => hasBody(declaration));
  }

  /** The functions with bodies `caller`'s body calls, witnesses included. */
  #calleesOf(caller: FunctionDeclaration): readonly FunctionDeclaration[] {
    const calls = this.#checker.bodyOf(caller)?.madeCalls() ?? [];
    const callees = new Set(
      calls.flatMap(({ call }) =>
        [
          ...functionCallsWithin(call),
          ...(call.kind === 'requirement' ? (this.#dispatch.witnessesOf(call) ?? []) : []),
        ].map((each) => each.function),
      ),
    );
    return [...callees].filter(hasBody);
  }

  /** The members of `declaration`'s recursive group, in the call graph it reaches. */
  #groupFrom(declaration: FunctionDeclaration): readonly FunctionDeclaration[] {
    const edges = edgesReachedFrom<FunctionDeclaration, Call>(
      [declaration],
      (caller) => this.#callees.get(caller).map((callee) => ({ from: caller, to: callee })),
      (call) => call.to,
    );
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
      const analyses = this.#analyzeAll(members, current, recursive);
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
    recursive: boolean,
  ): ReadonlyMap<FunctionDeclaration, Analysis> {
    return new Map(
      members.map((member) => [member, this.#analyzeFunction(member, guesses, recursive)]),
    );
  }

  #analyzeFunction(
    declaration: FunctionDeclaration,
    group: ReadonlyMap<FunctionDeclaration, Summary>,
    recursive: boolean,
  ): Analysis {
    const flow = this.#flowOf(declaration);
    if (flow === undefined) {
      return { summary: emptySummary, violations: [], inputTypes: new Map() };
    }
    const parameters = this.#checker.parametersOf(declaration);
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
      recursive,
    });
    return {
      ...found,
      summary: withDefaults(found.summary, this.#declared.defaultsOf(declaration)),
    };
  }

  /** The flow of `declaration`'s body, if it has one: its body's only root's, as checking built it. */
  #flowOf(declaration: FunctionDeclaration): FlowFunction | undefined {
    const body = this.#checker.bodyOf(declaration);
    return body === undefined ? undefined : flowsBuiltFor(body).values().next().value;
  }

  /** Every flow `module`'s bodies have: its functions', their defaults', its context constants'. */
  #flowsOf(module: ModuleId): readonly FlowFunction[] {
    const items = this.#checker.inputs.itemsOf(module);
    const functions = functionsOf({ items });
    return [
      ...functions.flatMap((declaration) =>
        hasBody(declaration) ? (this.#flowOf(declaration) ?? []) : [],
      ),
      ...functions.flatMap((declaration) =>
        defaultsFlows(this.#checker, declaration).map(({ flow }) => flow),
      ),
      ...constantsOf(items).flatMap(
        (declaration) => constantFlow(this.#checker, declaration) ?? [],
      ),
    ];
  }

  /** What `call`'s function does: a group member's guess, or its summary. */
  #calleeSummary(
    call: FunctionCall,
    group: ReadonlyMap<FunctionDeclaration, Summary> | undefined,
  ): Summary {
    return group?.get(call.function) ?? this.#summaries.get(call.function);
  }

  /**
   * What calling `declaration` does, one entry for every kind of function, so a call reads one: a
   * native's declaration (design.md §6.4), a fields function's construction, or a body's summary;
   * each with what its defaults do, since a call may run any of them.
   */
  #summaryOf(declaration: FunctionDeclaration): Summary {
    if (hasBody(declaration)) {
      return this.#analysisOf(declaration).summary;
    }
    const own = declaration.isExtern
      ? nativeSummary(this.#checker, declaration)
      : constructorSummary(this.#checker, declaration);
    return withDefaults(own, this.#declared.defaultsOf(declaration));
  }
}

/**
 * Whether `declaration` is written with a body: neither an extern nor a fields function. Read off
 * its declaration, so an edit inside a body leaves what asks alone; a body the parser lost is
 * analysed as doing nothing, its error reported elsewhere.
 */
function hasBody(declaration: FunctionDeclaration): boolean {
  return !(declaration.isExtern || isFieldsFunction(declaration));
}

/** `type`, written in `call`'s function, as `call` instantiates it. */
function substitutedIn(checker: CheckerContext, type: Type, call: FunctionCall): Type {
  const substitution = substitutionOf({
    declaration: call.function,
    typeArguments: call.typeArguments,
  });
  return substitute(type, substitution, checker.typeRules);
}

/** The constants of a module's `items`: its context constants and its top-level ones. */
function constantsOf(
  items: ReturnType<CheckerContext['inputs']['itemsOf']>,
): readonly (ContextConstantDeclaration | ConstantDeclaration)[] {
  return items.filter(
    (item): item is ContextConstantDeclaration | ConstantDeclaration =>
      item.kind === 'ContextConstantDeclaration' || item.kind === 'VariableDeclaration',
  );
}
