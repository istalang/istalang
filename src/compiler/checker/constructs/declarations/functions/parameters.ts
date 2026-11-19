/**
 * Functions' parameters (§6.1), each function's computed once: their types, and the checked body
 * of their defaults.
 *
 * - A parameter's type is its annotation. Only a parameter with a default and no annotation takes
 *   its type from its default, so only then do the types need the defaults checked; otherwise the
 *   defaults are checked apart, when their diagnostics or lowering ask. Choosing a call therefore
 *   never checks the defaults of a function it doesn't choose.
 * - A default reaching its own function through calls, while that function's types wait on it, is a
 *   cycle, reported at the function, whose parameters then stand as written, a type taken from a
 *   default read as the error type (foundation/structures/entries/); its defaults keep their
 *   checking.
 */

import type { EntryTable } from '../../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../../foundation/structures/equality.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import {
  defaultValuesOf,
  writesType,
  writtenByReference,
} from '../../../../syntax/expressions/parameters.ts';
import type { SignatureParameter } from '../../../check.ts';
import type { CheckerContext, CheckerNote } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { FlowRoot } from '../../../rules/flow/build/index.ts';
import type { CheckedBody } from '../../../surface/checked-body.ts';
import { sameTypeSpelled } from '../../../types/parts/type-parts.ts';
import type { RestSlot } from '../../../types/type/function-types.ts';
import type { Type } from '../../../types/type/index.ts';
import { type DefaultValues, declaredParameters, writtenParameters } from './signatures.ts';

/** A body in which a function's defaults are checked, and what checking `values` found. */
export interface DefaultsBody extends DefaultValues {
  readonly checked: (values: readonly Expression[]) => CheckedBody;
}

/** What a body checking defaults does: check a value, declare a parameter, finish. */
interface DefaultsChecking {
  readonly expect: (value: Expression, declared: Type | undefined) => Type;
  readonly declare: (parameter: SignatureParameter) => void;
  readonly finished: (roots: readonly FlowRoot[]) => CheckedBody;
}

/**
 * A body checking a function's defaults through `checking`, each default seeing the parameters
 * declared before it, and its flow taking them, as a call leaving it out runs it with them.
 */
export function defaultsBody(checking: DefaultsChecking): DefaultsBody {
  const declared: SignatureParameter[] = [];
  const before = new Map<Expression, readonly SignatureParameter[]>();
  return {
    check: (value, type) => {
      before.set(value, [...declared]);
      return checking.expect(value, type);
    },
    declare: (node, type) => {
      // No rest parameter comes before a default: it would take the arguments the default's.
      const parameter = { node, type, reference: writtenByReference(node), rest: undefined };
      declared.push(parameter);
      checking.declare(parameter);
    },
    checked: (values) =>
      checking.finished(values.map((root) => ({ root, parameters: before.get(root) ?? [] }))),
  };
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

/** Whether two lists of parameters are the same nodes, each typed and passed alike. */
const sameParameters = sameItems<SignatureParameter>(
  (first, second) =>
    first.node === second.node &&
    first.reference === second.reference &&
    sameTypeSpelled(first.type, second.type) &&
    sameRest(first.rest, second.rest),
);

function sameRest(first: RestSlot | undefined, second: RestSlot | undefined): boolean {
  if (first?.kind === 'array') {
    return second?.kind === 'array' && sameTypeSpelled(first.item, second.item);
  }
  return first?.kind === second?.kind;
}

export class Parameters {
  readonly #unit: ParameterUnit;
  /** Each function's parameters; a function's whose defaults reach them stand as written. */
  readonly #types: EntryTable<CheckerNote, FunctionDeclaration, readonly SignatureParameter[]>;
  /** The defaults of a function whose parameters all declare their types. */
  readonly #defaults: EntryTable<CheckerNote, FunctionDeclaration, CheckedBody>;
  /** Types and defaults together, for a function whose types wait on a default. */
  readonly #together: EntryTable<CheckerNote, FunctionDeclaration, Checked>;

  constructor(unit: ParameterUnit) {
    this.#unit = unit;
    const { checker } = unit;
    this.#types = checker.entries.table({
      name: 'parameters',
      compute: (declaration) =>
        typesWaitOnDefaults(declaration)
          ? this.#together.get(declaration).parameters
          : declaredParameters(checker, checker.moduleOf(declaration), declaration, undefined),
      equal: sameParameters,
      cyclic: {
        standIn: (declaration) =>
          writtenParameters(checker, checker.moduleOf(declaration), declaration),
        reportMember: (member) =>
          checker.report(
            checker.moduleOf(member),
            checkerDiagnostics.defaultCycle(member.name.span, member.name.text),
          ),
      },
    });
    this.#defaults = checker.entries.table({
      name: 'parameter defaults',
      compute: (declaration) => this.#checkDefaults(declaration),
    });
    this.#together = checker.entries.table({
      name: 'parameters with defaults',
      compute: (declaration) => {
        const module = checker.moduleOf(declaration);
        const body = this.#unit.defaultsBody(declaration);
        const parameters = declaredParameters(checker, module, declaration, body);
        return { parameters, defaults: body.checked(defaultValuesOf(declaration.parameters)) };
      },
    });
  }

  parametersOf(declaration: FunctionDeclaration): readonly SignatureParameter[] {
    return this.#types.get(declaration);
  }

  /** Whether a function's defaults are being checked to type its parameters. */
  typingDefaults(): boolean {
    return this.#together.anyRunning();
  }

  /**
   * The checked defaults of `declaration`; none, without an entry, where it writes none. Those
   * its types wait on are reached through its types, so a cycle through them always reaches the
   * types first.
   */
  defaultsOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    if (defaultValuesOf(declaration.parameters).length === 0) {
      return undefined;
    }
    if (typesWaitOnDefaults(declaration)) {
      this.parametersOf(declaration);
      return this.#together.get(declaration).defaults;
    }
    return this.#defaults.get(declaration);
  }

  /** The defaults of a function whose parameters all declare their types, checked against them. */
  #checkDefaults(declaration: FunctionDeclaration): CheckedBody {
    const values = defaultValuesOf(declaration.parameters);
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

/** Whether a parameter takes its type from its default, writing none (`writesType`). */
function typesWaitOnDefaults(declaration: FunctionDeclaration): boolean {
  return declaration.parameters.some(
    (parameter) =>
      parameter.kind === 'Parameter' &&
      parameter.defaultValue !== undefined &&
      !writesType(parameter),
  );
}
