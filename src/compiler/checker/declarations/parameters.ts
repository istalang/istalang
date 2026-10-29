/**
 * Functions' parameters (§3.3), each function's computed once: their types, and the checked body
 * of their defaults.
 *
 * - A parameter's type is its annotation. Only a parameter with a default and no annotation takes
 *   its type from its default, so only then do the types need the defaults checked; otherwise the
 *   defaults are checked apart, when their diagnostics or lowering ask. Choosing a call therefore
 *   never checks the defaults of a function it doesn't choose.
 * - A default reaching its own function through calls, while that function's types wait on it, is
 *   a cycle, reported at the function, whose parameters then stand as written, a type taken from
 *   a default read as the error type (structures/entries.ts); its defaults keep their checking.
 */

import type { EntryTable } from '../../../structures/entries.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { CheckedBody, SignatureParameter } from '../check.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type DefaultValues, declaredParameters, writtenParameters } from './signatures.ts';

/** A body in which a function's defaults are checked, and what checking `values` found. */
interface DefaultsBody extends DefaultValues {
  readonly checked: (values: readonly Expression[]) => CheckedBody;
}

interface ParameterUnit {
  readonly checker: CheckerContext;
  /** A fresh body to check `declaration`'s defaults in. */
  readonly defaultsBody: (declaration: FunctionDeclaration) => DefaultsBody;
}

interface Checked {
  readonly parameters: readonly SignatureParameter[];
  readonly defaults: CheckedBody | undefined;
}

export class Parameters {
  readonly #unit: ParameterUnit;
  /** Each function's parameters; a function's whose defaults reach them stand as written. */
  readonly #types: EntryTable<CheckerNote, FunctionDeclaration, readonly SignatureParameter[]>;
  /** The defaults of a function whose parameters all declare their types. */
  readonly #defaults: EntryTable<CheckerNote, FunctionDeclaration, CheckedBody | undefined>;
  /** Types and defaults together, for a function whose types wait on a default. */
  readonly #together: EntryTable<CheckerNote, FunctionDeclaration, Checked>;

  constructor(unit: ParameterUnit) {
    this.#unit = unit;
    const { checker } = unit;
    this.#types = checker.entries.table({
      standIn: (declaration) =>
        writtenParameters(checker, checker.moduleOf(declaration), declaration),
      reportMember: (member) =>
        checker.report(
          checker.moduleOf(member),
          checkerDiagnostics.defaultCycle(member.name.span, member.name.text),
        ),
    });
    this.#defaults = checker.entries.table();
    this.#together = checker.entries.table();
  }

  parametersOf(declaration: FunctionDeclaration): readonly SignatureParameter[] {
    return this.#types.get(declaration, () => {
      if (typesWaitOnDefaults(declaration)) {
        return this.#checkedTogether(declaration).parameters;
      }
      const { checker } = this.#unit;
      return declaredParameters(checker, checker.moduleOf(declaration), declaration, undefined);
    });
  }

  /**
   * The checked defaults of `declaration`. Those its types wait on are reached through its
   * types, so a cycle through them always reaches the types first.
   */
  defaultsOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    if (typesWaitOnDefaults(declaration)) {
      this.parametersOf(declaration);
      return this.#checkedTogether(declaration).defaults;
    }
    return this.#defaults.get(declaration, () => this.#checkDefaults(declaration));
  }

  #checkedTogether(declaration: FunctionDeclaration): Checked {
    return this.#together.get(declaration, () => {
      const { checker } = this.#unit;
      const module = checker.moduleOf(declaration);
      const body = this.#unit.defaultsBody(declaration);
      const parameters = declaredParameters(checker, module, declaration, body);
      return { parameters, defaults: body.checked(defaultValuesOf(declaration)) };
    });
  }

  /** The defaults of a function whose parameters all declare their types, checked against them. */
  #checkDefaults(declaration: FunctionDeclaration): CheckedBody | undefined {
    const values = defaultValuesOf(declaration);
    if (values.length === 0) {
      return undefined;
    }
    const body = this.#unit.defaultsBody(declaration);
    for (const parameter of this.parametersOf(declaration)) {
      const { defaultValue } = parameter.node;
      if (defaultValue !== undefined) {
        body.check(defaultValue, parameter.type);
      }
      body.declare(parameter.node, parameter.type);
    }
    return body.checked(values);
  }
}

/** The default values of `declaration`'s parameters, in order. */
function defaultValuesOf(declaration: FunctionDeclaration): readonly Expression[] {
  return declaration.parameters.flatMap((parameter) =>
    parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
      ? [parameter.defaultValue]
      : [],
  );
}

/** Whether a parameter takes its type from its default, having no annotation. */
function typesWaitOnDefaults(declaration: FunctionDeclaration): boolean {
  return declaration.parameters.some(
    (parameter) =>
      parameter.kind === 'Parameter' &&
      parameter.defaultValue !== undefined &&
      parameter.type === undefined,
  );
}
