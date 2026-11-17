/**
 * Where a type names a type parameter only where layout ignores it (§3.5): what lets an instance
 * take a stand-in for it and lay out every value alike (opaque-parameters.ts).
 *
 * - The parameter itself, a tuple's element, a function type's parameter or result, an anonymous
 *   struct's field: their layouts never read the type.
 * - A declared type's argument, when its own layout (its fields, its shared value's, its variants',
 *   an extern type's arguments) names it so in turn, and its declared parameter there is
 *   constrained by nothing, which an argument naming a stand-in could not meet.
 * - Never inside a union, whose variants are ordered by their members' types, an `any`, computed
 *   or recursive type, a function type's pack or mark, or an `Instance`, whose entry writes its
 *   outcome by type.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { type TypeParameter, typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { NominalType, ParameterKey, Type } from '../../types/type/index.ts';
import { wellKnownArguments } from '../../types/type/well-known.ts';

export type TypeReader = Pick<
  CheckerContext,
  'constraintsOf' | 'fieldsOf' | 'sharedValueOf' | 'typeKeys' | 'variantsOf' | 'wellKnownType'
>;

/** Whether `type` names `parameter` only where layout ignores it. */
export function opaquelyNamed(
  checker: TypeReader,
  type: Type,
  parameter: TypeParameter,
  laidOut: ReadonlySet<string> = new Set(),
): boolean {
  if (!names(type, parameter)) {
    return true;
  }
  const opaque = (part: Type) => opaquelyNamed(checker, part, parameter, laidOut);
  switch (type.kind) {
    case 'parameter':
      return type.declaration === parameter && type.within === undefined;
    case 'tuple':
      return type.elements.every(opaque);
    case 'function':
      return (
        (type.pack === undefined || !names(type.pack, parameter)) &&
        !names(type.mark, parameter) &&
        [...type.parameters.map((each) => each.type), type.result].every(opaque)
      );
    case 'anonymous':
      return type.fields.every((field) => opaque(field.type));
    case 'nominal':
      return layoutOpaque(checker, type, parameter, laidOut);
    default:
      return false;
  }
}

/**
 * Whether a declared type's layout names `parameter` only opaquely, at any depth: a type reached
 * again inside its own layout adds nothing to what the walk so far finds.
 */
function layoutOpaque(
  checker: TypeReader,
  type: NominalType,
  parameter: TypeParameter,
  laidOut: ReadonlySet<string>,
): boolean {
  const key = checker.typeKeys.typeKey(type);
  if (laidOut.has(key)) {
    return true;
  }
  const declared = typeParametersOf(type.entity.declaration.typeParameters);
  const atConstrained = type.arguments.some((argument, position) => {
    const given = declared[position];
    return (
      names(argument, parameter) && (given === undefined || isConstrained(checker, declared, given))
    );
  });
  if (atConstrained || wellKnownArguments(checker, wellKnown.instance, type) !== undefined) {
    return false;
  }
  const within = new Set([...laidOut, key]);
  return layoutParts(checker, type).every((part) =>
    opaquelyNamed(checker, part, parameter, within),
  );
}

/** The types a declared type is laid out by: its fields, its value's, its variants' or, extern, its arguments. */
function layoutParts(checker: TypeReader, type: NominalType): readonly Type[] {
  switch (type.entity.declaration.kind) {
    case 'StructDeclaration':
      return (checker.fieldsOf(type) ?? []).map((field) => field.type);
    case 'SharedStructDeclaration':
      return (checker.sharedValueOf(type)?.fields ?? []).map((field) => field.type);
    case 'EnumDeclaration':
      return (checker.variantsOf(type) ?? []).flatMap((variant) =>
        variant.fields.map((field) => field.type),
      );
    case 'ExternStructDeclaration':
      return type.arguments;
    default: {
      const unhandled: never = type.entity.declaration;
      return unhandled;
    }
  }
}

/**
 * Whether `parameter`, one of `own`, differs by more than its argument's lifetime class: it is
 * constrained, a mark's (`in`) or a pack, or another of `own`'s constraints names it.
 */
export function isConstrained(
  checker: Pick<CheckerContext, 'constraintsOf'>,
  own: readonly TypeParameter[],
  parameter: TypeParameter,
): boolean {
  return (
    parameter.isPack ||
    parameter.memberOf !== undefined ||
    parameter.constraints.length > 0 ||
    own.some((other) =>
      checker
        .constraintsOf(other)
        .some(({ arguments: types }) => types.some((type) => names(type, parameter))),
    )
  );
}

/** Whether `type` names `parameter`. */
export function names(type: Type, parameter: ParameterKey): boolean {
  return parametersIn(type).includes(parameter);
}
