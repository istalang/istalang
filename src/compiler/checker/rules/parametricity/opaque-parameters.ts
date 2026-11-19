/**
 * Parametricity (§8.1): the type parameters a generic function's code uses only opaquely, passing
 * their values on and never asking which type they are of, so one instance per representation of
 * their arguments runs every instantiation alike (lowering/tables/stencils.ts). Lowering writes a
 * body from its flows alone (surface/flow-ir.ts), and closes the calls its code reaches
 * (surface/reach.ts), so those two are what is read. Conservative: a parameter stays concrete
 * wherever a type could tell, which costs an instance, never a wrong one.
 *
 * - A parameter is concrete when it is constrained, a mark's (`in`) or a pack, or another
 *   parameter's constraint names it: witnesses and kinds are per type.
 * - An extern's are concrete unless it is `@_Parametric`: its native reads none of them.
 * - A function a test mocks keeps every parameter concrete: a mock replaces one entry (§18).
 * - What its flows do with it (its own, its defaults', its closures'): flow-uses.ts. Every type
 *   there names it only where layout ignores it (opaque-types.ts).
 * - Every call its code reaches (surface/reach.ts: written, made by the language, a wait's, a
 *   type's `dispose`) gives it to a callee parameter that is opaque, never a requirement.
 * - A call of the function itself giving each parameter itself reads nothing new; any other cycle
 *   answers its table's stand-in, every parameter concrete.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { sameMembers } from '../../../../foundation/structures/equality.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FlowChecker } from '../../surface/checked-body.ts';
import type { FlowFunction } from '../../surface/flow-ir.ts';
import { reachedCalls } from '../../surface/reach.ts';
import { instantiatingTypesOf, type ResolvedCall } from '../../surface/resolved-call.ts';
import type { Type } from '../../types/type/index.ts';
import { annotationNamed } from '../annotations/named.ts';
import { flowOpaque, type Judge } from './flow-uses.ts';
import { isConstrained, names, opaquelyNamed } from './opaque-types.ts';

type Reader = FlowChecker &
  Pick<
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

/**
 * `opaqueParametersOf` over `checker`'s entries: each function's answer an entry of its own, none
 * for a function `mocked` gives, which a mock replaces at one instance.
 */
export function opaqueParametersQuery(
  checker: Reader & Pick<CheckerContext, 'entries'>,
  mocked: CheckerContext['mockedFunctions'],
): CheckerContext['opaqueParametersOf'] {
  const table = checker.entries.table({
    name: 'opaque parameters',
    compute: (declaration: FunctionDeclaration) =>
      mocked().has(declaration)
        ? new Set<TypeParameter>()
        : opaqueParametersOf(checker, declaration, query),
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
    const judge: Judge = {
      parameter,
      laidOut: (type) => opaquelyNamed(checker, type, parameter),
      names: (type) => names(type, parameter),
    };
    return (
      this.#codeFlows.every((flow) => flowOpaque(judge, flow)) &&
      this.#reached.every((call) => this.#callOpaque(call, parameter))
    );
  }

  /** The flows of the code: its body's and each of its defaults'. */
  #flows(): readonly FlowFunction[] {
    const checker = this.#checker;
    const declaration = this.#declaration;
    const block = checker.inputs.bodyOf(checker.moduleOf(declaration), declaration);
    const body =
      block === undefined ? undefined : checker.bodyOf(declaration)?.flowOf(block, checker);
    const defaults = checker.defaultsOf(declaration);
    const defaultFlows = declaration.parameters.flatMap((each) =>
      each.kind === 'Parameter' && each.defaultValue !== undefined && defaults !== undefined
        ? [defaults.flowOf(each.defaultValue, checker)]
        : [],
    );
    return [...(body === undefined ? [] : [body]), ...defaultFlows];
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
