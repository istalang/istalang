/**
 * A value made to fit where the checker found it fits (§2, checker/types/fit.ts): converted once,
 * into an `any` type, a struct's value rebuilt as its shape (§3.1), a plain function made async, or
 * between a one-element tuple and its element, or a literal taken as its base, then put into a
 * union where the fit says. The checker records the fit per value, so
 * this is the one place lowering acts on it, and no handler needs to know about conversions.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ValueSite } from '../../checker/surface/checked-body.ts';
import { type Fit, singleElement } from '../../checker/types/fit.ts';
import type { FunctionType, StructValueType, Type } from '../../checker/types/type.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { membersOf } from '../../checker/types/unions/unions.ts';
import { madeAsync } from '../async-fits.ts';
import type { FunctionContext } from '../context.ts';
import { tupleOf } from '../expressions/tuples.ts';
import type { BodyOwner } from '../instances.ts';
import { rebuiltAs } from '../struct-values.ts';
import { convertedIntoAny } from '../trait-objects/trait-objects.ts';
import { asBase, intoUnion } from '../unions.ts';

/** A register and the type of the value it holds. */
interface TypedRegister {
  readonly value: Register;
  readonly type: Type;
}

/** Where a value is fitted: the site the checker recorded the fit at, in a body of `owner`. */
interface FittingSite {
  readonly owner: BodyOwner;
  readonly site: ValueSite;
}

/** `typed`, as the checker fitted it at `where`: converted, then put into a union. */
export function fittedValue(
  context: FunctionContext,
  typed: TypedRegister,
  fit: Fit,
  where: FittingSite,
): Register {
  const converted = convertedValue(context, typed, fit.conversion, where);
  return fit.into === undefined
    ? converted.value
    : intoUnion(
        context,
        { register: converted.value, type: fit.into.member ?? converted.type },
        fit.into.union,
        where.site.span,
      );
}

function convertedValue(
  context: FunctionContext,
  typed: TypedRegister,
  conversion: Fit['conversion'],
  where: FittingSite,
): TypedRegister {
  const { site } = where;
  switch (conversion.kind) {
    case 'none':
      return typed;
    case 'any': {
      const { to } = conversion;
      const value = convertedIntoAny(
        context,
        { value: typed.value, from: typed.type, to },
        site.span,
      );
      return { value, type: to };
    }
    case 'async': {
      const plain = functionTypeOf(typed.type);
      const value = madeAsync(context, { ...where, type: plain }, typed.value);
      return { value, type: { ...plain, isAsync: true } };
    }
    case 'shape': {
      const { to } = conversion;
      const from = structTypeOf(typed.type);
      return { value: rebuiltAs(context, typed.value, { from, to }, site.span), type: to };
    }
    case 'tupled':
      return {
        value: tupleOf(context, [typed.value], site.span),
        type: { kind: 'tuple', elements: [typed.type] },
      };
    case 'base': {
      const value = asBase(context, { register: typed.value, type: typed.type }, site.span);
      return { value, type: baseOfAll(typed.type) };
    }
    case 'untupled': {
      const element = singleElement(typed.type);
      if (element === undefined) {
        unreachable('Only a one-element tuple is untupled.');
      }
      return { value: context.code.field(typed.value, 0, site.span), type: element };
    }
    default: {
      const unhandled: never = conversion;
      return unhandled;
    }
  }
}

/** `type`, whose value the checker converted into a shape, so a nominal struct. */
function structTypeOf(type: Type): StructValueType {
  if (type.kind !== 'nominal' && type.kind !== 'anonymous') {
    unreachable(`Only a struct's value converts into a shape, not a ${type.kind} type's.`);
  }
  return type;
}

/** `type`, which the checker made async to fit, so a function type. */
function functionTypeOf(type: Type): FunctionType {
  if (type.kind !== 'function') {
    unreachable(`Only a function is made async, not a ${type.kind} type.`);
  }
  return type;
}

/** The base a literal type, or a union of literals of one base, is taken as. */
function baseOfAll(type: Type): Type {
  const [first] = membersOf(type);
  return first === undefined ? unreachable('A union has members.') : baseOf(first);
}
