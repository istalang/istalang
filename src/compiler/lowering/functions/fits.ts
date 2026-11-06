/**
 * A value made to fit where the checker found it fits (§2, checker/types/fitting/fit.ts): converted
 * once, into an `any` type, a struct's value rebuilt as its shape (§3.1), a plain function made
 * async, or between a one-element tuple and its element, or a literal taken as its base, then put
 * into a union where the fit says. The checker records the fit per value, so this is the one place
 * lowering acts on it, and no handler needs to know about conversions.
 *
 * A plain function value made async where an async function is expected (§3.14) becomes a closure
 * capturing the plain value, whose entry is async and calls it with the arguments it is given. So
 * calling the closure starts an async function that returns at once, which gives a future already
 * resolved, and never suspends. The entry is one per site in a body's instance, so a trace through
 * it points at where the value was made async.
 */

import type { Register } from '../../../definition/operands.ts';
import type { CodeFunction } from '../../../definition/tables/functions.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ValueSite } from '../../checker/surface/checked-body.ts';
import { type Fit, singleElement } from '../../checker/types/fitting/fit.ts';
import type { FunctionType, StructValueType, Type } from '../../checker/types/type/index.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { membersOf } from '../../checker/types/unions/unions.ts';
import { emitCall } from '../calls/emit-call.ts';
import { tupleOf } from '../constructs/expressions/literals/tuples.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import { SynthesizedCode } from '../synthesized/index.ts';
import { convertedIntoAny } from '../synthesized/trait-objects.ts';
import type { AsyncFit, BodyOwner } from '../tables/instances.ts';
import { rebuiltAs } from '../values/struct-values.ts';
import { asBase, intoUnion } from '../values/unions.ts';

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

/** `value`, the plain function `fit` makes async: a closure of its fit's entry. */
function madeAsync(context: CodeContext, fit: AsyncFit, value: Register): Register {
  const dst = context.code.allocate();
  const entry = context.tables.asyncFitIndex(fit);
  const { span } = fit.site;
  context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [value] });
  return dst;
}

/** The async entry of `fit`: it calls the value it captures with its own arguments. */
export function asyncFitEntry(
  context: Pick<CodeContext, 'checker' | 'tables'>,
  fit: AsyncFit,
): CodeFunction {
  const references = fit.type.parameters.map((parameter) => parameter.reference);
  const code = new SynthesizedCode(context, fit.site.span, references.length, 1);
  const [plain] = code.captures;
  if (plain === undefined) {
    unreachable('An async fit captures the function it calls.');
  }
  const result = emitCall(code, {
    span: code.span,
    callee: { kind: 'value', register: plain },
    arguments: code.parameters.map((_, index) => code.passedOn(index, references)),
  });
  code.return(result);
  return code.entry(context.tables.asyncFitHeader(fit), true, references);
}
