/**
 * What the lifetime rule finds where a declaration stands rather than in a body it has
 * (lifetimes.ts runs the bodies):
 *
 * - **Defaults** a function's parameters or a struct's fields compute: each run at a call that
 *   leaves its argument out, with the parameters before it, so each is analysed as a function of
 *   those. Its violations are reported where it stands; its summary joins the function's, as a
 *   call that may run it does what it does; and what its value relates to is the argument a call
 *   leaving it out passes (`results`). They are analysed with their function, in its recursive
 *   group (lifetimes.ts): a default may call back into the function or the struct it belongs to.
 * - **A constant's initializer,** a context constant's or a top-level one's, a root: nothing
 *   calls it with anything.
 * - **A `dispose`,** which the runtime runs on any value of its type (design.md §5.5).
 */

import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { isDisposeFunction } from '../disposal/disposal.ts';
import { flowsBuiltFor } from '../flow/build/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';
import type { AnalysisContext } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import { joinedSummaries } from './composition.ts';
import { cycleRelevance, escapingCycles } from './escaping.ts';
import type { FindingDeclaration, Violation } from './finding.ts';
import type { GivenValue, Summary } from './summary.ts';

/** What a function's defaults find. */
export interface DefaultsFound {
  readonly violations: readonly Violation[];
  /** Each default's summary, over the parameters before it. */
  readonly summaries: readonly Summary[];
  /** What each default's value relates to, by its parameter's position. */
  readonly results: ReadonlyMap<number, GivenValue>;
}

/** What defaults find where a function writes none. */
export const noDefaults: DefaultsFound = { violations: [], summaries: [], results: new Map() };

/** What the declared findings read of the rule over the program. */
export interface DeclaredDeps {
  readonly checker: CheckerContext;
  readonly context: () => AnalysisContext;
  readonly analysisOf: (declaration: FunctionDeclaration) => Analysis;
  readonly hasBody: (declaration: FunctionDeclaration) => boolean;
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
  const built = flowsBuiltFor(defaults);
  return declaration.parameters.flatMap((parameter, index) => {
    const flow =
      parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
        ? built.get(parameter.defaultValue)
        : undefined;
    return flow === undefined ? [] : [{ index, flow }];
  });
}

/** The flow of a constant's initializer, a context constant's or a top-level one's. */
function constantFlow(
  checker: CheckerContext,
  declaration: ContextConstantDeclaration | VariableDeclaration,
): FlowFunction | undefined {
  const body =
    declaration.kind === 'ContextConstantDeclaration'
      ? checker.contextConstants.bodyOf(declaration)
      : checker.constantBodyOf(declaration);
  return body === undefined ? undefined : flowsBuiltFor(body).get(declaration.initializer);
}

/**
 * What `declaration`'s defaults find, analysed in `context`, as members of a recursive group
 * where `recursive` says, so their findings name inputs whole, as the group's bodies do.
 */
export function defaultsFound(
  checker: CheckerContext,
  context: AnalysisContext,
  declaration: FunctionDeclaration,
  recursive: boolean,
): DefaultsFound {
  const flows = defaultsFlows(checker, declaration);
  if (flows.length === 0) {
    return noDefaults;
  }
  const parameters = checker.parametersOf(declaration);
  const found = flows.map(({ index, flow }) => {
    const references = new Set(
      flow.parameters.filter((_, at) => parameters[at]?.reference === true),
    );
    return {
      index,
      analysis: analyze(context, flow, { isAsync: false, references, recursive }),
    };
  });
  return {
    violations: found.flatMap(({ analysis }) => analysis.violations),
    summaries: found.map(({ analysis }) => analysis.summary),
    results: new Map(found.map(({ index, analysis }) => [index, analysis.summary.result])),
  };
}

/**
 * `summary`, doing what its defaults do too, as a call may run any of them. What a default's
 * value relates to is its parameter's (`results`), never the function's result.
 */
export function withDefaults(summary: Summary, defaults: DefaultsFound): Summary {
  return defaults.summaries.length === 0
    ? summary
    : {
        ...joinedSummaries([summary, ...defaults.summaries]),
        result: summary.result,
        gives: summary.gives,
      };
}

export class Declared {
  readonly #deps: DeclaredDeps;

  constructor(deps: DeclaredDeps) {
    this.#deps = deps;
  }

  /**
   * What `declaration` violates where it stands, beside its body and its defaults: a `dispose`
   * letting go of what it was given, a constant's initializer.
   */
  violationsOf(declaration: FindingDeclaration): readonly Violation[] {
    const { checker } = this.#deps;
    const context = this.#deps.context();
    if (declaration.kind !== 'FunctionDeclaration') {
      const flow = constantFlow(checker, declaration);
      return flow === undefined
        ? []
        : analyze(context, flow, { isAsync: false, references: new Set() }).violations;
    }
    if (!(this.#deps.hasBody(declaration) && isDisposeFunction(checker, declaration))) {
      return [];
    }
    const parameters = checker.parametersOf(declaration);
    return escapingCycles(context.facts, this.#deps.analysisOf(declaration).summary, (input) =>
      input.kind === 'parameter' ? parameters[input.index]?.type : undefined,
    )
      .filter((cycle) => cycleRelevance(context.facts, cycle) !== 'no')
      .map(({ deciding }) => ({
        kind: 'closure' as const,
        site: declaration.name,
        holderType: deciding,
        callee: undefined,
      }));
  }
}
