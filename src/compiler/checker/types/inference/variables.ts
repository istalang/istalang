/**
 * A call's type variables (§3.5): one per type parameter it infers, a key of its own, so they stay
 * apart from the same declaration's parameters standing rigid where the call is written, as a
 * generic function's own call inside its body has them (`fn flip<A, B>` calling `flip(b, a)`
 * gives its variable for `A` the rigid `B`, never itself). Matching, bounds and settling read the
 * variables; what an inference tells its callers reads the parameters again (`restored`).
 *
 * A variable is its parameter's twin: one per parameter, made once, so what an inference makes of
 * it is bounded however many calls are inferred. It keeps what its parameter is: a pack, and a
 * member parameter's union, which it carries (`within`), its own parameters made variables too.
 * What the program declares of a parameter (its constraints, its union, the module declaring it)
 * is read for its twin too, through `standingFor` (wiring/program/program-checker.ts), the one
 * place a twin meets the program.
 *
 * A system joining several calls of one function would need a twin per call (tracker I2).
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import type { ParameterKey, Type, TypeParameterType } from '../type/index.ts';
import type { Settling } from './settle.ts';

/** Each parameter's twin, and each twin's parameter. */
const twins = new WeakMap<ParameterKey, ParameterKey>();
const standing = new WeakMap<ParameterKey, ParameterKey>();

/** The twin standing for `parameter` while a call infers it. */
function twinOf(parameter: ParameterKey): ParameterKey {
  let twin = twins.get(parameter);
  if (twin === undefined) {
    twin = { ...parameter };
    twins.set(parameter, twin);
    standing.set(twin, parameter);
  }
  return twin;
}

/** The parameter `key` stands for: `key` itself, unless it is a call's variable (the banner). */
export function standingFor<Key extends ParameterKey>(key: Key): Key {
  return (standing.get(key) as Key | undefined) ?? key;
}

export class CallVariables {
  readonly #fitting: Fitting;
  /** Each parameter's variable, as a type. */
  readonly #renaming = new Map<ParameterKey, TypeParameterType>();
  readonly #parameters = new Map<ParameterKey, ParameterKey>();

  constructor(parameters: Iterable<ParameterKey>, fitting: Fitting) {
    this.#fitting = fitting;
    const unions = new Map<ParameterKey, Type>();
    for (const parameter of parameters) {
      const variable = twinOf(parameter);
      this.#parameters.set(variable, parameter);
      this.#renaming.set(parameter, { kind: 'parameter', declaration: variable });
      const union = fitting.memberUnionOf({ kind: 'parameter', declaration: parameter });
      if (union !== undefined) {
        unions.set(parameter, union);
      }
    }
    for (const [parameter, union] of unions) {
      const variable = this.#renaming.get(parameter);
      if (variable !== undefined) {
        this.#renaming.set(parameter, { ...variable, within: this.freshened(union) });
      }
    }
  }

  /** The variable inferring `parameter`; undefined for a parameter the call doesn't infer. */
  variableOf(parameter: ParameterKey): ParameterKey | undefined {
    return this.#renaming.get(parameter)?.declaration;
  }

  /** The variable `variable` infers the parameter of, as a type. */
  typeOf(parameter: ParameterKey): TypeParameterType | undefined {
    return this.#renaming.get(parameter);
  }

  /** The parameter `variable` infers; undefined for anything else. */
  parameterOf(variable: ParameterKey): ParameterKey | undefined {
    return this.#parameters.get(variable);
  }

  /** Whether `key` is one of these variables. */
  isVariable(key: ParameterKey): boolean {
    return this.#parameters.has(key);
  }

  /** The variables, in their parameters' order. */
  get variables(): readonly ParameterKey[] {
    return [...this.#parameters.keys()];
  }

  /** `type`, a declared one, with each parameter the call infers made its variable. */
  freshened(type: Type, given: Substitution = new Map()): Type {
    const renaming = new Map<ParameterKey, Type>(this.#renaming);
    for (const [parameter, value] of given) {
      renaming.set(parameter, value);
    }
    return substitute(type, renaming, this.#fitting);
  }

  /** `byParameter`'s types, by the variables of their parameters; the rest left out. */
  byVariable(byParameter: ReadonlyMap<ParameterKey, Type>): Map<ParameterKey, Type> {
    const found = new Map<ParameterKey, Type>();
    for (const [parameter, type] of byParameter) {
      const variable = this.variableOf(parameter);
      if (variable !== undefined) {
        found.set(variable, type);
      }
    }
    return found;
  }

  /** `settling`, asked of the parameters the variables infer, as it is written for them. */
  settlingFor(settling: Settling): Settling {
    const parameterOf = (variable: ParameterKey) => this.parameterOf(variable) ?? variable;
    return {
      admits: (variable, type) => settling.admits(parameterOf(variable), this.restored(type)),
      defaultOf: (variable, settled) => {
        const restored = new Map<ParameterKey, Type>();
        for (const [each, type] of settled) {
          restored.set(parameterOf(each), this.restored(type));
        }
        const type = settling.defaultOf(parameterOf(variable), restored);
        return type === undefined ? undefined : this.freshened(type);
      },
    };
  }

  /** `type` with each variable read as its parameter again. */
  restored(type: Type): Type {
    const back = new Map<ParameterKey, Type>();
    for (const [variable, parameter] of this.#parameters) {
      back.set(variable, { kind: 'parameter', declaration: parameter });
    }
    return substitute(type, back, this.#fitting);
  }
}
