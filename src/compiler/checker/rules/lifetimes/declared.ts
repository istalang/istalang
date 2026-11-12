/**
 * What the lifetime rule finds where a declaration stands rather than in a body it has
 * (lifetimes.ts runs the bodies):
 *
 * - **Defaults** a function's parameters or a struct's fields compute: each run at a call that
 *   leaves its argument out, with the parameters before it, so each is analysed as a function of
 *   those. Its violations are reported where it stands; its summary joins the function's, as a
 *   call that may run it does what it does; and what its value relates to is the argument a call
 *   leaving it out passes (`results`).
 * - **A constant's initializer,** a context constant's or a top-level one's, a root: nothing
 *   calls it with anything.
 * - **A `dispose`,** which the runtime runs on any value of its type (design.md §5.5).
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { ModuleId } from '../../../program/program.ts';
import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { FindingDeclaration } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import { isDisposeFunction } from '../disposal/disposal.ts';
import type { FlowInputs } from '../flow/build/flow-builder.ts';
import { flowOf } from '../flow/build/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';
import type { AnalysisContext, Violation } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import { joinedSummaries } from './composition.ts';
import { cycleRelevance, escapingCycles } from './escaping.ts';
import type { ResultRelation, Summary } from './summary.ts';

/** What a function's defaults find. */
export interface DefaultsFound {
  readonly violations: readonly Violation[];
  /** Each default's summary, over the parameters before it. */
  readonly summaries: readonly Summary[];
  /** What each default's value relates to, by its parameter's position. */
  readonly results: ReadonlyMap<number, readonly ResultRelation[]>;
}

const none: DefaultsFound = { violations: [], summaries: [], results: new Map() };

/** What the declared findings read of the rule over the program. */
export interface DeclaredDeps {
  readonly checker: CheckerContext;
  readonly context: () => AnalysisContext;
  readonly analysisOf: (declaration: FunctionDeclaration) => Analysis;
  readonly hasBody: (declaration: FunctionDeclaration) => boolean;
}

/** What a body of `module` gives the flow builder. */
export function flowInputsOf(
  checker: CheckerContext,
  module: ModuleId,
  body: CheckedBody,
): FlowInputs {
  return {
    checker,
    module,
    localBodyOf: (local: FunctionDeclaration) => checker.inputs.bodyOf(module, local),
    body,
  };
}

/** A default's flow, of the parameters before it, and its parameter's position. */
interface DefaultFlow {
  readonly index: number;
  readonly flow: FlowFunction;
}

/** The flows of the defaults `declaration`'s parameters or fields compute. */
export function defaultsFlows(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
): readonly DefaultFlow[] {
  const defaults = checker.defaultsOf(declaration);
  if (defaults === undefined) {
    return [];
  }
  const inputs = flowInputsOf(checker, checker.moduleOf(declaration), defaults);
  const parameters = checker.parametersOf(declaration);
  return declaration.parameters.flatMap((parameter, index) =>
    parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
      ? [
          {
            index,
            flow: flowOf(inputs, parameter.defaultValue, parameters.slice(0, index)),
          },
        ]
      : [],
  );
}

/** The flow of a constant's initializer, a context constant's or a top-level one's. */
export function constantFlow(
  checker: CheckerContext,
  declaration: ContextConstantDeclaration | VariableDeclaration,
): FlowFunction | undefined {
  const body =
    declaration.kind === 'ContextConstantDeclaration'
      ? checker.contextConstants.bodyOf(declaration)
      : checker.constantBodyOf(declaration);
  return body === undefined
    ? undefined
    : flowOf(flowInputsOf(checker, checker.moduleOf(declaration), body), declaration.initializer);
}

/** `summary`, doing what its defaults do too, as a call may run any of them. */
export function withDefaults(summary: Summary, defaults: DefaultsFound): Summary {
  return defaults.summaries.length === 0
    ? summary
    : joinedSummaries([summary, ...defaults.summaries]);
}

export class Declared {
  readonly #deps: DeclaredDeps;
  readonly #defaults: EntryTable<CheckerNote, FunctionDeclaration, DefaultsFound>;
  readonly #declared: EntryTable<CheckerNote, FindingDeclaration, readonly Violation[]>;

  constructor(deps: DeclaredDeps) {
    this.#deps = deps;
    this.#defaults = deps.checker.entries.table({
      name: 'lifetime defaults',
      compute: (declaration: FunctionDeclaration) => this.#defaultsFound(declaration),
      // A default reaching its own function is an error of its own (§3.3), found elsewhere.
      cyclic: { standIn: () => none },
    });
    this.#declared = deps.checker.entries.table({
      name: 'lifetime declared findings',
      compute: (declaration: FindingDeclaration) => this.#violationsOf(declaration),
    });
  }

  defaultsOf(declaration: FunctionDeclaration): DefaultsFound {
    return this.#defaults.get(declaration);
  }

  violationsOf(declaration: FindingDeclaration): readonly Violation[] {
    return this.#declared.get(declaration);
  }

  #violationsOf(declaration: FindingDeclaration): readonly Violation[] {
    const { checker } = this.#deps;
    const context = this.#deps.context();
    if (declaration.kind !== 'FunctionDeclaration') {
      const flow = constantFlow(checker, declaration);
      return flow === undefined
        ? []
        : analyze(context, flow, { isAsync: false, references: new Set() }).violations;
    }
    const parameters = checker.parametersOf(declaration);
    const atDispose =
      this.#deps.hasBody(declaration) && isDisposeFunction(checker, declaration)
        ? escapingCycles(context.facts, this.#deps.analysisOf(declaration).summary, (input) =>
            input.kind === 'parameter' ? parameters[input.index]?.type : undefined,
          )
            .filter((cycle) => cycleRelevance(context.facts, cycle) !== 'no')
            .map(({ deciding }) => ({
              kind: 'closure' as const,
              site: declaration.name,
              holderType: deciding,
              callee: undefined,
            }))
        : [];
    return [...this.defaultsOf(declaration).violations, ...atDispose];
  }

  #defaultsFound(declaration: FunctionDeclaration): DefaultsFound {
    const { checker } = this.#deps;
    const context = this.#deps.context();
    const flows = defaultsFlows(checker, declaration);
    if (flows.length === 0) {
      return none;
    }
    const parameters = checker.parametersOf(declaration);
    const found = flows.map(({ index, flow }) => {
      const references = new Set(
        flow.parameters.filter((_, at) => parameters[at]?.reference === true),
      );
      return { index, analysis: analyze(context, flow, { isAsync: false, references }) };
    });
    return {
      violations: found.flatMap(({ analysis }) => analysis.violations),
      summaries: found.map(({ analysis }) => analysis.summary),
      results: new Map(found.map(({ index, analysis }) => [index, analysis.summary.result])),
    };
  }
}
