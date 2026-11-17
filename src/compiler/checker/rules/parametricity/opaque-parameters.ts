/**
 * Parametricity (§3.5): the type parameters a generic function's code uses only opaquely, passing
 * their values on and never asking which type they are of, so one instance per lifetime class of
 * their arguments runs every instantiation alike (lowering/tables/stencils.ts). Lowering writes a
 * body from its flows alone (surface/flow-ir.ts), and closes the calls its code reaches
 * (surface/reach.ts), so those two are what is read. Conservative: a parameter stays concrete
 * wherever a type could tell, which costs an instance, never a wrong one.
 *
 * - A parameter is concrete when it is constrained, a mark's (`in`) or a pack, or another
 *   parameter's constraint names it: witnesses and kinds are per type.
 * - An extern's are concrete unless it is `@_Parametric`: its native reads none of them.
 * - Every type its code holds, each value's of its flows (its own, its defaults', its closures')
 *   and its signature's, names it only where layout ignores it (opaque-types.ts).
 * - A test or downcast naming it, or a conversion of parts naming it (lowering converts through the
 *   prelude's own functions), makes it concrete, as does a requirement call naming it, or a call
 *   giving it to a callee parameter that is concrete; a wait on a value naming it reads the
 *   prelude functions lowering waits through as such callees.
 * - A `transient` variable, one per instance (§3.4), keeps every parameter concrete.
 * - A call of the function itself giving each parameter itself reads nothing new; any other cycle
 *   answers its table's stand-in, every parameter concrete.
 */

import { waitFunctions } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { languageModules, wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { sameMembers } from '../../../../foundation/structures/equality.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { PartStep, TypeTest } from '../../surface/checked-pattern.ts';
import type { FlowFunction, Part } from '../../surface/flow-ir.ts';
import { reachedCalls } from '../../surface/reach.ts';
import { instantiatingTypesOf, type ResolvedCall } from '../../surface/resolved-call.ts';
import { isExact } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';
import { annotationNamed } from '../annotations/named.ts';
import { isConstrained, names, opaquelyNamed } from './opaque-types.ts';

type Reader = Pick<
  CheckerContext,
  | 'annotations'
  | 'bodyOf'
  | 'constraintsOf'
  | 'defaultsOf'
  | 'disposalOf'
  | 'externHeldOf'
  | 'fieldsOf'
  | 'inputs'
  | 'json'
  | 'languageFunctions'
  | 'moduleOf'
  | 'parametersOf'
  | 'resultOf'
  | 'sharedValueOf'
  | 'typeKeys'
  | 'typeRules'
  | 'variantsOf'
  | 'wellKnownEntity'
  | 'wellKnownType'
>;

/** `opaqueParametersOf` over `checker`'s entries: each function's answer an entry of its own. */
export function opaqueParametersQuery(
  checker: Reader & Pick<CheckerContext, 'entries'>,
): CheckerContext['opaqueParametersOf'] {
  const table = checker.entries.table({
    name: 'opaque parameters',
    compute: (declaration: FunctionDeclaration) => opaqueParametersOf(checker, declaration, query),
    equal: sameMembers,
    cyclic: { standIn: () => new Set<TypeParameter>() },
  });
  const query = (declaration: FunctionDeclaration): ReadonlySet<TypeParameter> =>
    table.get(declaration);
  return query;
}

/**
 * The type parameters of `declaration` its code uses only opaquely; `opaqueOf` answers the same of
 * a function it calls.
 */
function opaqueParametersOf(
  checker: Reader,
  declaration: FunctionDeclaration,
  opaqueOf: (callee: FunctionDeclaration) => ReadonlySet<TypeParameter>,
): ReadonlySet<TypeParameter> {
  const own = typeParametersOf(declaration.typeParameters);
  if (own.length === 0 || (declaration.isExtern && !isParametric(checker, declaration))) {
    return new Set();
  }
  const candidates = own.filter((parameter) => !isConstrained(checker, own, parameter));
  if (candidates.length === 0 || declaration.isExtern) {
    return new Set(candidates);
  }
  const uses = new Uses(checker, declaration, opaqueOf);
  return new Set(candidates.filter((parameter) => uses.opaque(parameter)));
}

/** Whether `declaration` is marked as a native reading none of its type arguments. */
function isParametric(checker: Reader, declaration: FunctionDeclaration): boolean {
  return annotationNamed(checker, declaration, wellKnown.parametric) !== undefined;
}

/** What one function's code does with its type parameters. */
class Uses {
  readonly #checker: Reader;
  readonly #declaration: FunctionDeclaration;
  readonly #opaqueOf: (callee: FunctionDeclaration) => ReadonlySet<TypeParameter>;
  /** What every parameter is read against, found once: the signature's types, flows and calls. */
  #signature: readonly Type[] | undefined;
  #codeFlows: readonly FlowFunction[] | undefined;
  #reached: readonly ResolvedCall[] | undefined;

  constructor(
    checker: Reader,
    declaration: FunctionDeclaration,
    opaqueOf: (callee: FunctionDeclaration) => ReadonlySet<TypeParameter>,
  ) {
    this.#checker = checker;
    this.#declaration = declaration;
    this.#opaqueOf = opaqueOf;
  }

  /** Whether the code uses `parameter` only opaquely. */
  opaque(parameter: TypeParameter): boolean {
    const checker = this.#checker;
    const declaration = this.#declaration;
    this.#signature ??= [
      ...checker.parametersOf(declaration).map(({ type }) => type),
      checker.resultOf(declaration),
    ];
    const signature = this.#signature;
    if (!signature.every((type) => opaquelyNamed(this.#checker, type, parameter))) {
      return false;
    }
    this.#codeFlows ??= this.#flows();
    this.#reached ??= reachedCalls(checker, declaration).map(({ call }) => call);
    return (
      this.#codeFlows.every((flow) => this.#flowOpaque(flow, parameter)) &&
      this.#reached.every((call) => this.#callOpaque(call, parameter))
    );
  }

  /** The flows of the code: its body's and each of its defaults'. */
  #flows(): readonly FlowFunction[] {
    const checker = this.#checker;
    const declaration = this.#declaration;
    const block = checker.inputs.bodyOf(checker.moduleOf(declaration), declaration);
    const body = block === undefined ? undefined : checker.bodyOf(declaration)?.flowOf(block);
    const defaults = checker.defaultsOf(declaration);
    const defaultFlows = declaration.parameters.flatMap((each) =>
      each.kind === 'Parameter' && each.defaultValue !== undefined && defaults !== undefined
        ? [defaults.flowOf(each.defaultValue)]
        : [],
    );
    return [...(body === undefined ? [] : [body]), ...defaultFlows];
  }

  /** Whether `flow`, and every closure it makes, uses `parameter` only opaquely. */
  #flowOpaque(flow: FlowFunction, parameter: TypeParameter): boolean {
    const typed = (type: Type | undefined) =>
      type === undefined || opaquelyNamed(this.#checker, type, parameter);
    if (!flow.values.every(({ type }) => typed(type))) {
      return false;
    }
    const valueType = (id: number) => flow.values[id]?.type;
    const namedBy = (id: number) => {
      const type = valueType(id);
      return type !== undefined && names(type, parameter);
    };
    return flow.blocks.every(({ operations, exit }) => {
      const opaqueExit =
        exit.kind !== 'branch' ||
        (exit.test.kind === 'is' && !testNames(exit.test.test, parameter)) ||
        (exit.test.kind === 'select' &&
          (!exit.test.futures.some(namedBy) || this.#waitsOpaque())) ||
        (exit.test.kind !== 'is' && exit.test.kind !== 'select' && exit.test.kind !== 'transient');
      return (
        opaqueExit &&
        operations.every((operation) => {
          switch (operation.op) {
            case 'read':
              return this.#partOpaque(operation.part, parameter);
            case 'write':
              return operation.place.path.every((part) => this.#partOpaque(part, parameter));
            case 'make':
              return operation.made.kind === 'closure'
                ? this.#flowOpaque(operation.made.function, parameter)
                : operation.made.kind !== 'variant' || typed(operation.made.type);
            case 'copy': {
              const { fit } = operation;
              const converts = fit !== undefined && fit !== 'intoKeyedField' && !isExact(fit);
              return !(converts && (namedBy(operation.from) || namedBy(operation.into)));
            }
            case 'suspend':
              return !operation.awaited.some(namedBy) || this.#waitsOpaque();
            case 'compute':
              return operation.computation.kind !== 'typeValue' || !namedBy(operation.into);
            default:
              return true;
          }
        })
      );
    });
  }

  /**
   * Whether the prelude functions lowering writes a wait through, each given a case's type
   * (`waitFunctions`), use it only opaquely.
   */
  #waitsOpaque(): boolean {
    const casesWith = [waitFunctions.caseInto, waitFunctions.caseResolver, waitFunctions.caseTaken];
    return casesWith.every((name) =>
      this.#checker.languageFunctions(languageModules.prelude, name).every((declaration) => {
        const [value] = typeParametersOf(declaration.typeParameters);
        return value !== undefined && this.#opaqueOf(declaration).has(value);
      }),
    );
  }

  /** Whether reading `part` takes nothing apart by `parameter`. */
  #partOpaque(part: Part, parameter: TypeParameter): boolean {
    if (part.kind === 'required') {
      return !names(part.on, parameter);
    }
    return part.kind !== 'step' || this.#stepOpaque(part.step, parameter);
  }

  #stepOpaque(step: PartStep, parameter: TypeParameter): boolean {
    if (typeof step === 'number') {
      return true;
    }
    switch (step.kind) {
      case 'member':
        return !(names(step.union, parameter) || names(step.member, parameter));
      case 'downcast':
        return !names(step.to, parameter);
      case 'variantField':
        return opaquelyNamed(this.#checker, step.type, parameter);
      case 'field':
        return opaquelyNamed(this.#checker, step.of, parameter);
      case 'fieldRest':
        return !(names(step.from, parameter) || names(step.to, parameter));
      default:
        return true;
    }
  }

  /** Whether `call` keeps `parameter` opaque: a function's own parameter is given it, opaque. */
  #callOpaque(call: ResolvedCall, parameter: TypeParameter): boolean {
    if (call.kind === 'requirement') {
      return !instantiatingTypesOf(call).some((type) => names(type, parameter));
    }
    const calleeParameters = typeParametersOf(call.function.typeParameters);
    return call.typeArguments.every((argument, position) => {
      if (!names(argument, parameter)) {
        return true;
      }
      const given = calleeParameters[position];
      if (given === undefined || !opaquelyNamed(this.#checker, argument, parameter)) {
        return false;
      }
      const itself =
        call.function === this.#declaration &&
        argument.kind === 'parameter' &&
        argument.declaration === given;
      return itself || this.#opaqueOf(call.function).has(given);
    });
  }
}

/** Whether a test tells values apart by a type naming `parameter`. */
function testNames(tested: TypeTest, parameter: TypeParameter): boolean {
  switch (tested.kind) {
    case 'variant':
      return false;
    case 'downcast':
      return names(tested.to, parameter);
    case 'member':
      return (
        names(tested.union, parameter) || tested.members.some((each) => names(each, parameter))
      );
    default: {
      const unhandled: never = tested;
      return unhandled;
    }
  }
}
