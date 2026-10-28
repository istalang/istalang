/**
 * A value made to fit where the checker found it fits (§2, checker/types/fit.ts): converted once,
 * into an `any` type, a plain function made async, or between a one-element tuple and its element,
 * then wrapped into as many optionals as the fit says. The checker records the fit per value, so
 * this is the one place lowering acts on it, and no handler needs to know about conversions.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ValueSite } from '../../checker/check.ts';
import { type Fit, singleElement } from '../../checker/types/fit.ts';
import type { FunctionType, Type } from '../../checker/types/type.ts';
import { madeAsync } from '../async-fits.ts';
import type { FunctionContext } from '../context.ts';
import { tupleOf } from '../expressions/tuples.ts';
import { buildVariant } from '../expressions/variants.ts';
import type { BodyOwner } from '../instances.ts';
import { readPart } from '../places.ts';
import { convertedIntoAny } from '../trait-objects/trait-objects.ts';

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

/** `typed`, as the checker fitted it at `where`: converted, then wrapped. */
export function fittedValue(
  context: FunctionContext,
  typed: TypedRegister,
  fit: Fit,
  where: FittingSite,
): Register {
  const converted = convertedValue(context, typed, fit.conversion, where);
  let register = converted.value;
  let current = converted.type;
  for (let left = fit.wraps; left > 0; left -= 1) {
    const optional = context.checker.optionalOf(current);
    const some = { type: optional, name: optionalVariants.some };
    register = buildVariant(context, some, [register], where.site.span);
    current = optional;
  }
  return register;
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
    case 'tupled':
      return {
        value: tupleOf(context, [typed.value], site.span),
        type: { kind: 'tuple', elements: [typed.type] },
      };
    case 'untupled': {
      const element = singleElement(typed.type);
      if (element === undefined) {
        unreachable('Only a one-element tuple is untupled.');
      }
      return { value: readPart(context, typed.value, [0], site.span), type: element };
    }
    default: {
      const unhandled: never = conversion;
      return unhandled;
    }
  }
}

/** `type`, which the checker made async to fit, so a function type. */
function functionTypeOf(type: Type): FunctionType {
  if (type.kind !== 'function') {
    unreachable(`Only a function is made async, not a ${type.kind} type.`);
  }
  return type;
}
