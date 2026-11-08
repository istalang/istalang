/**
 * A call's type variables (§3.5): one per type parameter it infers, a key of its own, so they stay
 * apart from the same declaration's parameters standing rigid where the call is written, as a
 * generic function's own call inside its body has them (`fn flip<A, B>` calling `flip(b, a)`
 * gives its variable for `A` the rigid `B`, never itself). Matching, bounds and settling read the
 * variables; what an inference tells its callers reads the parameters again (`restored`).
 *
 * A variable is its parameter's twin at the call's site: one per parameter and site, made once, so
 * the calls one system joins (system.ts) each have their own, as `pair(id(1), id("a"))` has two
 * `T`s, while what inferences make of them is bounded by the program's call sites however often
 * one is inferred. An inference with no site of its own (a trait requirement's instantiation) has
 * one twin per parameter. A variable keeps what its parameter is: a pack, and a member parameter's
 * union, which it carries (`within`), its own parameters made variables too. What the program
 * declares of a parameter (its constraints, its union, the module declaring it) is read for its
 * twin too, through `standingFor` (wiring/program/program-checker.ts), the one place a twin meets
 * the program.
 */

import { memo } from '../../../../foundation/structures/memo.ts';
import type { Fitting } from '../fitting/fit/index.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type, TypeParameterType } from '../type/index.ts';
import type { Settling } from './settle.ts';

/** Each parameter's twins, by the site they stand at; and each twin's parameter. */
const twins = new WeakMap<object, Map<ParameterKey, ParameterKey>>();
const standing = new WeakMap<ParameterKey, ParameterKey>();

/** The twin standing for `parameter` while a call at `site` infers it. */
function twinOf(parameter: ParameterKey, site: object): ParameterKey {
  const atSite = memo(twins, site, () => new Map<ParameterKey, ParameterKey>());
  return memo(atSite, parameter, () => {
    const twin = { ...parameter };
    standing.set(twin, parameter);
    return twin;
  });
}

/** The parameter `key` stands for: `key` itself, unless it is a call's variable (the banner). */
export function standingFor<Key extends ParameterKey>(key: Key): Key {
  return (standing.get(key) as Key | undefined) ?? key;
}

/**
 * Whether `type` is a placeholder (i2-scope.md §3): the type of an expression a constraint scope
 * checks once it knows what is expected of it.
 */
export function isPlaceholder(type: Type | undefined): type is TypeParameterType {
  return type?.kind === 'parameter' && standingFor(type.declaration).kind === 'Placeholder';
}

/**
 * Whether every variable `type` mentions is a placeholder, which reads as `_` where a type is
 * shown, as an argument no type of its own is known for does.
 */
export function mentionsOnlyPlaceholders(type: Type): boolean {
  return parametersIn(type).every(
    (key) => !standing.has(key) || standingFor(key).kind === 'Placeholder',
  );
}

/** Whether `type` mentions a call's variable, of any system. */
export function mentionsAnyVariable(type: Type): boolean {
  return parametersIn(type).some((key) => standing.has(key));
}

export class CallVariables {
  readonly #fitting: Fitting;
  /** Each parameter's variable, as a type. */
  readonly #renaming = new Map<ParameterKey, TypeParameterType>();
  readonly #parameters = new Map<ParameterKey, ParameterKey>();

  /** `site` is the call's own, if it has one; without, each parameter has one twin (the banner). */
  constructor(parameters: Iterable<ParameterKey>, fitting: Fitting, site?: object) {
    this.#fitting = fitting;
    const unions = new Map<ParameterKey, Type>();
    for (const parameter of parameters) {
      const variable = twinOf(parameter, site ?? parameter);
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
