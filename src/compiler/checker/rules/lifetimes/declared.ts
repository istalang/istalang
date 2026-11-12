/**
 * What the lifetime rule finds where a declaration stands rather than in a body it has
 * (lifetimes.ts runs the bodies):
 *
 * - **Defaults** a function's parameters or a struct's fields compute: each an escaping function
 *   of no inputs, its violations reported where it stands, and the types deciding the rest the
 *   function's own (`always`), for each instantiation to decide.
 * - **A context constant's initializer,** a root: nothing calls it with anything.
 * - **A `dispose`,** which the runtime runs on any value of its type (design.md §5.5).
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { ModuleId } from '../../../program/program.ts';
import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import type { Type } from '../../types/type/index.ts';
import { isDisposeFunction } from '../disposal/disposal.ts';
import type { FlowInputs } from '../flow/build/flow-builder.ts';
import { flowOf } from '../flow/build/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';
import type { AnalysisContext, Violation } from './analysis/body.ts';
import { type Analysis, analyze } from './analysis/index.ts';
import { escapingTypes } from './escaping.ts';
import { inputKey, type Summary } from './summary.ts';

/** What a function's defaults find. */
export interface DefaultsFound {
  readonly violations: readonly Violation[];
  readonly always: readonly Type[];
}

const none: DefaultsFound = { violations: [], always: [] };

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

/** The flows of the defaults `declaration`'s parameters or fields compute, each a root. */
export function defaultsFlows(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
): readonly FlowFunction[] {
  const defaults = checker.defaultsOf(declaration);
  if (defaults === undefined) {
    return [];
  }
  const inputs = flowInputsOf(checker, checker.moduleOf(declaration), defaults);
  return declaration.parameters.flatMap((parameter) =>
    parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
      ? [flowOf(inputs, parameter.defaultValue)]
      : [],
  );
}

/** The flow of a context constant's initializer. */
export function contextConstantFlow(
  checker: CheckerContext,
  declaration: ContextConstantDeclaration,
): FlowFunction {
  const body = checker.contextConstants.bodyOf(declaration);
  return flowOf(
    flowInputsOf(checker, checker.moduleOf(declaration), body),
    declaration.initializer,
  );
}

/** `summary`, with the types deciding its defaults' cycles among those it always closes. */
export function withDefaults(summary: Summary, defaults: DefaultsFound): Summary {
  return defaults.always.length === 0
    ? summary
    : { ...summary, always: [...summary.always, ...defaults.always] };
}

export class Declared {
  readonly #deps: DeclaredDeps;
  readonly #defaults: EntryTable<CheckerNote, FunctionDeclaration, DefaultsFound>;
  readonly #declared: EntryTable<
    CheckerNote,
    FunctionDeclaration | ContextConstantDeclaration,
    readonly Violation[]
  >;

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
      compute: (declaration: FunctionDeclaration | ContextConstantDeclaration) =>
        this.#violationsOf(declaration),
    });
  }

  defaultsOf(declaration: FunctionDeclaration): DefaultsFound {
    return this.#defaults.get(declaration);
  }

  violationsOf(
    declaration: FunctionDeclaration | ContextConstantDeclaration,
  ): readonly Violation[] {
    return this.#declared.get(declaration);
  }

  #violationsOf(
    declaration: FunctionDeclaration | ContextConstantDeclaration,
  ): readonly Violation[] {
    const { checker } = this.#deps;
    const context = this.#deps.context();
    if (declaration.kind === 'ContextConstantDeclaration') {
      const flow = contextConstantFlow(checker, declaration);
      return analyze(context, flow, { isAsync: false, references: new Set() }).violations;
    }
    const parameters = checker.parametersOf(declaration);
    const atDispose =
      this.#deps.hasBody(declaration) && isDisposeFunction(checker, declaration)
        ? escapingTypes(context.facts, this.#deps.analysisOf(declaration).summary, (input) =>
            input.kind === 'parameter' ? parameters[input.index]?.type : undefined,
          ).map((holderType) => ({
            kind: 'closure' as const,
            site: declaration.name,
            holderType,
            callee: undefined,
          }))
        : [];
    return [...this.defaultsOf(declaration).violations, ...atDispose].filter(
      ({ holderType }) => context.facts.relevanceOf(holderType) !== 'no',
    );
  }

  #defaultsFound(declaration: FunctionDeclaration): DefaultsFound {
    const { checker } = this.#deps;
    const context = this.#deps.context();
    const defaults = checker.defaultsOf(declaration);
    if (defaults === undefined) {
      return none;
    }
    const inputs = flowInputsOf(checker, checker.moduleOf(declaration), defaults);
    const roots = declaration.parameters.flatMap((parameter) =>
      parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
        ? [parameter.defaultValue]
        : [],
    );
    const found = roots.map((root) => {
      const analysis = analyze(context, flowOf(inputs, root), {
        isAsync: false,
        references: new Set(),
        nested: true,
      });
      const types = escapingTypes(context.facts, analysis.summary, (input) =>
        analysis.inputTypes.get(inputKey(input)),
      );
      return { root, analysis, types };
    });
    const relevance = (type: Type) => context.facts.relevanceOf(type);
    return {
      violations: found.flatMap(({ root, analysis, types }) => [
        ...analysis.violations,
        ...types
          .filter((type) => relevance(type) === 'yes')
          .map((holderType) => ({
            kind: 'closure' as const,
            site: root,
            holderType,
            callee: undefined,
          })),
      ]),
      always: found.flatMap(({ analysis, types }) =>
        [...types, ...analysis.summary.always].filter((type) => relevance(type) === 'depends'),
      ),
    };
  }
}
