/**
 * Static lifetimes over one checker's program (design.md): no heap cycle may pass through what
 * reaches a disposable, so counting alone decides when one loses its last holder.
 *
 * - **Bottom up, by summaries** (design.md §5.3): a function's analysis reads the summaries of
 *   what it calls, never their bodies, and a requirement reaching a function's callers is checked
 *   by each call. A group of functions calling each other is solved together, from summaries that
 *   do nothing, until none changes: the lattice over a group's inputs is finite.
 * - **Entries, as the expansion graph keeps them** (design.md §8): what each function calls; its
 *   recursive group, found in what it reaches; each group's analyses; each function's summary,
 *   which an edit keeping its effects leaves equal, so its callers stop there; and each
 *   function's reports, the only entry reading where its findings are. Relevance and the handles a
 *   type may hold are entries per type.
 * - **A caller reads of a callee its summary alone,** one entry per call: whether the callee has a
 *   body is read off its declaration, never off the body, which every edit inside it makes anew.
 *   Each revision validates every entry a module's check reaches, so an entry earns its place only
 *   by cutting work off (tracker P49).
 * - **Lazy:** a module's check reads the summaries of what its functions call, transitively, and
 *   nothing else.
 * - **Reported per module:** `check` reports each finding where it stands, through the
 *   `lifetime reports` entry (reports.ts).
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameEntries, sameItems } from '../../../../foundation/structures/equality.ts';
import { edgesReachedFrom } from '../../../../foundation/structures/reachable.ts';
import type { ModuleId } from '../../../program/program.ts';
import { functionsOf, isFieldsFunction } from '../../../syntax/declarations/field-defaults.ts';
import type {
  ConstantDeclaration,
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { FlowFunction } from '../../surface/flow-ir.ts';
import { type FunctionCall, functionCallsWithin } from '../../surface/resolved-call.ts';
import { callSubstitution } from '../../surface/witness-closing.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import type { AnalysisContext } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import { Declared, defaultsFlows, defaultsFound, withDefaults } from './declared.ts';
import { conversionsOf, witnessesConvertedIn, witnessesOf, witnessesPutIn } from './dispatch.ts';
import { summarizedByDeclaration } from './externs.ts';
import { typeFactsOf } from './facts.ts';
import type { FindingDeclaration, Violation } from './finding.ts';
import {
  type Call,
  type DefaultResults,
  doesNothing,
  type FunctionAnalysis,
  type GroupAnalyses,
  groupOf,
  hasBody,
  hasCode,
  sameGroupAnalyses,
} from './groups.ts';
import { type Input, sameInput } from './input.ts';
import { diagnosticOf } from './reports.ts';
import {
  constructorSummary,
  emptySummary,
  type GivenValue,
  nativeSummary,
  type Summary,
  sameSummary,
  sameValue,
  unrelatedValue,
} from './summary.ts';
import { transientsIn } from './transients.ts';

export class Lifetimes {
  readonly #checker: CheckerContext;
  readonly #callees: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #groups: EntryTable<CheckerNote, FunctionDeclaration, readonly FunctionDeclaration[]>;
  readonly #analyses: EntryTable<CheckerNote, FunctionDeclaration, GroupAnalyses>;
  readonly #summaries: EntryTable<CheckerNote, FunctionDeclaration, Summary>;
  readonly #defaultResults: EntryTable<CheckerNote, FunctionDeclaration, DefaultResults>;
  readonly #context: AnalysisContext;
  readonly #declared: Declared;
  readonly #reports: EntryTable<CheckerNote, FindingDeclaration, void, ModuleId>;
  readonly #transients: EntryTable<CheckerNote, ModuleId, readonly Input[]>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#transients = checker.entries.table({
      name: 'lifetime transients',
      compute: (module: ModuleId) =>
        transientsIn(checker, module, (type) => this.reachesDisposable(type)),
      equal: sameItems(sameInput),
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
      // Reached again only where a default types its own function, an error of its own (§6.1).
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
    this.#defaultResults = checker.entries.table({
      name: 'lifetime default results',
      compute: (declaration: FunctionDeclaration) => this.#analysisOf(declaration).defaults.results,
      equal: sameEntries(sameValue),
    });
    this.#declared = new Declared({
      checker,
      context: () => this.#context,
      analysisOf: (declaration) => this.#analysisOf(declaration),
      hasBody,
    });
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
      defaultResult: (declaration, index) => this.#defaultResult(declaration, index, undefined),
      substitute: (type, call) => substitutedIn(checker, type, call),
      readsWhatItIterates: (iterate) => checker.isStd(checker.moduleOf(iterate)),
      witnessesOf: (call) => witnessesOf(checker, call),
      conversionsOf: (copied) => conversionsOf(checker, copied),
      witnessesPutIn: (conversion) => witnessesPutIn(checker, conversion),
      transients: () => checker.inputs.modules().flatMap((module) => this.#transients.get(module)),
    };
  }

  /** Whether values of `type` may reach a disposable: what decides that the runtime counts them. */
  reachesDisposable(type: Type): boolean {
    return this.#context.facts.relevanceOf(type) !== 'no';
  }

  /** Reports what the rule finds in `module`, each where the cycle closes (design.md §7). */
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
      ...(declaration.kind === 'FunctionDeclaration' && hasCode(declaration)
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
    return functionsOf({ items }).filter(hasCode);
  }

  /**
   * The functions with code `caller`'s body and defaults call, witnesses included, and those of
   * what they put into an `any`, whose checks read their summaries.
   */
  #calleesOf(caller: FunctionDeclaration): readonly FunctionDeclaration[] {
    const checker = this.#checker;
    const calls = [
      ...((hasBody(caller) ? checker.bodyOf(caller)?.madeCalls() : undefined) ?? []),
      ...(checker.defaultsOf(caller)?.madeCalls() ?? []),
    ];
    const flows = [
      ...(hasBody(caller) ? [this.#flowOf(caller)] : []).filter((flow) => flow !== undefined),
      ...defaultsFlows(checker, caller).map(({ flow }) => flow),
    ];
    const callees = new Set(
      [
        ...calls.flatMap(({ call }) => [
          ...functionCallsWithin(call),
          ...(call.kind === 'requirement' ? (witnessesOf(checker, call) ?? []) : []),
        ]),
        ...flows.flatMap((flow) => witnessesConvertedIn(checker, flow)),
      ].map((each) => each.function),
    );
    return [...callees].filter((callee) => this.#analyzedForCallers(callee));
  }

  /** Whether `declaration`'s callers read its body's analysis, rather than its declaration. */
  #analyzedForCallers(declaration: FunctionDeclaration): boolean {
    return hasCode(declaration) && !summarizedByDeclaration(this.#checker, declaration);
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

  #analysisOf(declaration: FunctionDeclaration): FunctionAnalysis {
    const [first] = this.#groupOf(declaration) as [FunctionDeclaration];
    return this.#analyses.get(first).get(declaration) ?? doesNothing;
  }

  /**
   * Analyses a group's members together, bodies and defaults, from analyses doing nothing, until
   * no summary changes, a default's included: a default may call back into the group.
   */
  #analyzeGroup(members: readonly FunctionDeclaration[]): GroupAnalyses {
    const [first] = members as [FunctionDeclaration];
    const recursive = members.length > 1 || this.#callees.get(first).includes(first);
    let current: GroupAnalyses = new Map(members.map((member) => [member, doesNothing] as const));
    for (;;) {
      const next = this.#analyzeRound(members, current, recursive);
      if (!recursive || sameGroupAnalyses(current, next)) {
        return next;
      }
      current = next;
    }
  }

  /** One round of a group's analyses, reading the round before's as `guesses`. */
  #analyzeRound(
    members: readonly FunctionDeclaration[],
    guesses: GroupAnalyses,
    recursive: boolean,
  ): GroupAnalyses {
    return new Map(
      members.map((member) => [member, this.#analyzeFunction(member, guesses, recursive)]),
    );
  }

  /** `declaration`'s analysis, its body's and its defaults', reading `group`'s as guessed. */
  #analyzeFunction(
    declaration: FunctionDeclaration,
    group: GroupAnalyses,
    recursive: boolean,
  ): FunctionAnalysis {
    const context: AnalysisContext = {
      ...this.#context,
      calleeSummary: (call) => this.#calleeSummary(call, group),
      defaultResult: (callee, index) => this.#defaultResult(callee, index, group),
    };
    const own = this.#ownAnalysis(declaration, context, recursive);
    const defaults = defaultsFound(this.#checker, context, declaration, recursive);
    return {
      ...own,
      summary: withDefaults(own.summary, defaults),
      violations: [...own.violations, ...defaults.violations],
      defaults,
    };
  }

  /** What `declaration` does but for its defaults: its body's analysis, or a native's or fields'. */
  #ownAnalysis(
    declaration: FunctionDeclaration,
    context: AnalysisContext,
    recursive: boolean,
  ): Analysis {
    if (!hasBody(declaration)) {
      return { ...doesNothing, summary: this.#bodilessSummary(declaration) };
    }
    const flow = this.#flowOf(declaration);
    if (flow === undefined) {
      return doesNothing;
    }
    const parameters = this.#checker.parametersOf(declaration);
    const references = new Set(
      flow.parameters.filter((_, index) => parameters[index]?.reference === true),
    );
    return analyze(context, flow, {
      isAsync: declaration.qualifiers.async !== undefined,
      references,
      recursive,
    });
  }

  /** The flow of `declaration`'s body, if it has one, as checking built it. */
  #flowOf(declaration: FunctionDeclaration): FlowFunction | undefined {
    const checker = this.#checker;
    const block = checker.inputs.bodyOf(checker.moduleOf(declaration), declaration);
    return block === undefined ? undefined : checker.bodyOf(declaration)?.flowOf(block, checker);
  }

  /** What `call`'s function does: a group member's guess, or its summary. */
  #calleeSummary(call: FunctionCall, group: GroupAnalyses | undefined): Summary {
    return group?.get(call.function)?.summary ?? this.#summaries.get(call.function);
  }

  /**
   * What the default of `callee`'s parameter at `index` relates to: a group member's guess, or an
   * entry of its own, so an edit inside `callee`'s body keeping it stops there, as its summary
   * does.
   */
  #defaultResult(
    callee: FunctionDeclaration,
    index: number,
    group: GroupAnalyses | undefined,
  ): GivenValue {
    const results = group?.get(callee)?.defaults.results ?? this.#defaultResults.get(callee);
    return results.get(index) ?? unrelatedValue;
  }

  /**
   * What calling `declaration` does, one entry for every kind of function, so a call reads one: a
   * body's summary, a native's declaration (design.md §6.4) or a fields function's construction,
   * each with what its defaults do, since a call may run any of them.
   */
  #summaryOf(declaration: FunctionDeclaration): Summary {
    return this.#analyzedForCallers(declaration)
      ? this.#analysisOf(declaration).summary
      : this.#bodilessSummary(declaration);
  }

  /** What a native, a function declaring what it keeps or a fields function does, but for its defaults. */
  #bodilessSummary(declaration: FunctionDeclaration): Summary {
    return summarizedByDeclaration(this.#checker, declaration)
      ? nativeSummary(this.#checker, declaration)
      : constructorSummary(this.#checker, declaration);
  }
}

/** `type`, written in `call`'s function, as `call` instantiates it. */
function substitutedIn(checker: CheckerContext, type: Type, call: FunctionCall): Type {
  return substitute(type, callSubstitution(call), checker.typeRules);
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
