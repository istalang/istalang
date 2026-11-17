/**
 * A value made to fit where the checker found it fits (§2, checker/types/fitting/fit/index.ts):
 * converted once, into an `any` type, a struct's value rebuilt as its shape (§3.1), a plain
 * function made async, or between a one-element tuple and its element, or a literal taken as its
 * base, then put into a union where the fit says. The checker records the fit per value, so this is
 * the one place lowering acts on it, and no handler needs to know about conversions. A value
 * converted part by part (§3.5) is rebuilt by the entry of its pair of types where its layout
 * changes (parts.ts), each part fitted as the checker fits it.
 *
 * A function made async where an async function is expected (§3.14) is wrapped as any function
 * converted part by part is: a closure of the `wrapping` entry of its pair of types, capturing it.
 */

import type { FunctionId, Register } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import type { TypeReference } from '../../../../definition/tables/types.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { type Fit, singleElement } from '../../../checker/types/fitting/fit/index.ts';
import { resultFitBetween } from '../../../checker/types/fitting/part-pairs.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type { FunctionType, StructValueType, Type } from '../../../checker/types/type/index.ts';
import { membersOf } from '../../../checker/types/type/index.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall } from '../../calls/emit-call.ts';
import type { CodeContext, FunctionContext } from '../../context.ts';
import { SynthesizedCode } from '../../synthesized/index.ts';
import {
  type BodyOwner,
  type ConversionEntry,
  type ConversionSite,
  conversionName,
  ownerDeclaration,
} from '../../tables/instances.ts';
import { tableKey } from '../../tables/names.ts';
import { convertedIntoAny } from '../../values/into-any.ts';
import { rebuiltAs, tupleOf } from '../../values/struct-values.ts';
import { asBase, intoUnion } from '../../values/unions.ts';
import { builtKindOf, codeModeOf } from '../modes.ts';
import { changesLayout, type Rebuilding, rebuilt } from './parts.ts';

/** A register and the type of the value it holds. */
interface TypedRegister {
  readonly value: Register;
  readonly type: Type;
}

/** Where a value is fitted: the site the checker recorded the fit at, in a body of `owner`. */
interface FittingSite {
  readonly owner: BodyOwner;
  readonly site: NodeOf<string>;
}

/**
 * How a fit is made where it is: the span its code points at, and where an entry a conversion of
 * parts needs is named.
 */
interface Applying {
  readonly span: AnchoredSpan;
  readonly at: ConversionSite;
}

/** `typed`, as the checker fitted it at `where`: converted, then put into a union. */
export function fittedValue(
  context: FunctionContext,
  typed: TypedRegister,
  fit: Fit,
  { owner, site }: FittingSite,
): Register {
  const module = context.checker.moduleOf(ownerDeclaration(owner));
  return appliedFit(context, typed, fit, { span: site.span, at: { module, span: site.span } });
}

/** `typed`, made to fit as `fit` says: converted, then put into a union. */
function appliedFit(context: CodeContext, typed: TypedRegister, fit: Fit, how: Applying): Register {
  const converted = convertedValue(context, typed, fit.conversion, how);
  return fit.into === undefined
    ? converted.value
    : intoUnion(
        context,
        { register: converted.value, type: fit.into.member ?? converted.type },
        fit.into.union,
        how.span,
      );
}

function convertedValue(
  context: CodeContext,
  typed: TypedRegister,
  conversion: Fit['conversion'],
  how: Applying,
): TypedRegister {
  const { span } = how;
  switch (conversion.kind) {
    case 'none':
      return typed;
    case 'any': {
      const { to } = conversion;
      const value = convertedIntoAny(context, { value: typed.value, from: typed.type, to }, span);
      return { value, type: to };
    }
    case 'async': {
      const { to } = conversion;
      const from = functionTypeOf(typed.type);
      return { value: wrappedClosure(context, typed.value, { from, to }, how), type: to };
    }
    case 'shape': {
      const { to } = conversion;
      const from = structTypeOf(typed.type);
      return { value: rebuiltAs(context, typed.value, { from, to }, span), type: to };
    }
    case 'tupled':
      return {
        value: tupleOf(context, [typed.value], span),
        type: { kind: 'tuple', elements: [typed.type] },
      };
    case 'base': {
      const value = asBase(context, { register: typed.value, type: typed.type }, span);
      return { value, type: baseOfAll(typed.type) };
    }
    case 'untupled': {
      const element = singleElement(typed.type);
      if (element === undefined) {
        unreachable('Only a one-element tuple is untupled.');
      }
      const reference = context.tables.types.reference(element);
      return { value: context.code.tupleItem(typed.value, 0, reference, span), type: element };
    }
    case 'parts': {
      const { to } = conversion;
      return { value: partsConverted(context, typed, to, how), type: to };
    }
    default: {
      const unhandled: never = conversion;
      return unhandled;
    }
  }
}

/**
 * `typed` converted part by part into `to` (§3.5) where that changes its layout, by the entry of
 * the pair: a function's wraps it, any other's rebuilds it.
 */
function partsConverted(
  context: CodeContext,
  typed: TypedRegister,
  to: Type,
  how: Applying,
): Register {
  const { checker, tables } = context;
  if (!changesLayout(checker, typed.type, to)) {
    return typed.value;
  }
  const from = unfolded(typed.type);
  const target = unfolded(to);
  if (from.kind === 'function' && target.kind === 'function') {
    return wrappedClosure(context, typed.value, { from, to: target }, how);
  }
  const entry = tables.conversionIndex({ kind: 'converting', from: typed.type, to, at: how.at });
  return emitCall(
    context,
    { span: how.span, callee: entry, arguments: [typed.value] },
    tables.types.reference(to),
  );
}

/** `value`, a function of type `from`, wrapped as one of `to`: a closure of their wrapping entry. */
function wrappedClosure(
  context: CodeContext,
  value: Register,
  { from, to }: { readonly from: FunctionType; readonly to: FunctionType },
  { at, span }: Applying,
): Register {
  const entry = context.tables.conversionIndex({ kind: 'wrapping', from, to, at });
  return closureOf(context, { entry, captures: [value] }, context.tables.types.reference(to), span);
}

/** A closure of `entry`, of `type`, capturing `captures`. */
function closureOf(
  context: CodeContext,
  { entry, captures }: { readonly entry: FunctionId; readonly captures: readonly Register[] },
  type: TypeReference,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const dst = code.allocate(type);
  const taken = captures.map((capture) => code.take(capture, span));
  code.emit({ kind: 'closure', span, dst, function: entry, captures: taken });
  return dst;
}

/** How fits are made inside a conversion's entry: where its pair was first met. */
function applyingIn(at: ConversionSite): Applying {
  return { span: at.span, at };
}

/**
 * `typed` made to fit `to` inside a synthesized entry, as the checker fits the two types; an entry
 * a conversion needs is named for `at`, the first site its pair was met at.
 */
export function fittedIn(
  code: SynthesizedCode,
  typed: TypedRegister,
  to: Type,
  at: ConversionSite,
): Register {
  return appliedFit(code, typed, fitBetween(code, typed.type, to), applyingIn(at));
}

/** How a value is rebuilt inside a conversion's entry, each part fitted as the checker fits it. */
function rebuildingIn(code: SynthesizedCode, how: Applying): Rebuilding {
  const { tables } = code;
  const { at, span } = how;
  return {
    span,
    converted: (part, to) =>
      appliedFit(
        code,
        { value: part.register, type: part.type },
        fitBetween(code, part.type, to),
        how,
      ),
    converter: (from, to) =>
      closureOf(
        code,
        { entry: tables.conversionIndex({ kind: 'converting', from, to, at }), captures: [] },
        {
          kind: 'function',
          parameters: [tables.types.reference(from)],
          result: tables.types.reference(to),
        },
        span,
      ),
    wrapped: (value, from, to) => wrappedClosure(code, value, { from, to }, how),
  };
}

/** The fit of a value of `from` where `to` is expected, which the checker found before. */
function fitBetween(context: Pick<CodeContext, 'checker'>, from: Type, to: Type): Fit {
  return (
    context.checker.fitOf(from, to) ??
    unreachable(`A part converted into ${tableKey(context.checker, to)} fits it.`)
  );
}

/**
 * The entry making a value of `entry.from` fit `entry.to` as the checker fits them; its own pair
 * converting part by part is rebuilt here, as converting it by this entry would call itself.
 */
export function convertingEntry(
  lowering: Pick<CodeContext, 'checker' | 'tables'>,
  entry: Extract<ConversionEntry, { readonly kind: 'converting' }>,
): CodeFunction {
  const { checker, tables } = lowering;
  const { from, to, at } = entry;
  const code = new SynthesizedCode(lowering, at.span, {
    parameters: [tables.types.reference(from)],
    result: tables.types.reference(to),
    mode: 'simple',
  });
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A conversion takes the value it converts.');
  }
  const how = applyingIn(at);
  const fit = fitBetween(code, from, to);
  const result =
    fit.conversion.kind === 'parts' && fit.into === undefined
      ? rebuilt(code, { register: value, type: from }, to, rebuildingIn(code, how))
      : appliedFit(code, { value, type: from }, fit, how);
  code.return(result);
  return code.entry(tables.headerAt(conversionName(checker, entry), at.module, at.span));
}

/**
 * The entry of a function of type `entry.from` wrapped as one of `entry.to` (§3.5, §3.14): it
 * converts each argument it is given into what the function takes, a `&` passed on as it is,
 * calls the function it captures, and converts what it gives; where `to` gives a future of what it
 * gives, the entry is async, awaiting the future the function gives, if any, so the entry gives a
 * future already resolved when the function gives none.
 */
export function wrappingEntry(
  lowering: Pick<CodeContext, 'checker' | 'tables'>,
  entry: Extract<ConversionEntry, { readonly kind: 'wrapping' }>,
): CodeFunction {
  const { checker, tables } = lowering;
  const { from, to, at } = entry;
  const resultFit = resultFitBetween(checker, from, to);
  const async = resultFit.kind !== 'value';
  const code = new SynthesizedCode(lowering, at.span, {
    parameters: to.parameters.map((parameter) => {
      const type = tables.types.reference(parameter.type);
      return parameter.reference ? { kind: 'reference', to: type } : type;
    }),
    captures: [tables.types.reference(from)],
    result: tables.types.reference(async ? resultFit.into : to.result),
    mode: codeModeOf(async, builtKindOf(checker, entry.to)),
  });
  const [original] = code.captures;
  if (original === undefined) {
    unreachable('A wrapped function captures the function it calls.');
  }
  const passed = code.parameters.map((parameter, index) => {
    const taken = to.parameters[index];
    const own = from.parameters[index];
    if (taken === undefined || own === undefined || taken.reference) {
      return code.passedOn(index);
    }
    const register = fittedIn(code, { value: parameter, type: taken.type }, own.type, at);
    return { kind: 'value' as const, register };
  });
  const called = emitCall(
    code,
    { span: at.span, callee: { kind: 'value', register: original }, arguments: passed },
    tables.types.reference(from.result),
  );
  returnedAs(code, called, entry, at);
  const header = tables.headerAt(conversionName(checker, entry), at.module, at.span);
  return code.entry(header);
}

/**
 * Returns `called`, what a function of type `from` gave, as a function of type `to` gives it:
 * fitted to its result; where `to` gives a future of it, from an async entry, awaiting the future
 * `from` gave, if any, so the entry gives a future already resolved when `from` gives none. Whether
 * the entry is async.
 */
function returnedAs(
  code: SynthesizedCode,
  called: Register,
  { from, to }: { readonly from: FunctionType; readonly to: FunctionType },
  at: ConversionSite,
): void {
  const result = resultFitBetween(code.checker, from, to);
  if (result.kind === 'value') {
    code.return(fittedIn(code, { value: called, type: from.result }, to.result, at));
    return;
  }
  const value = result.kind === 'awaited' ? code.await(called, from.result) : called;
  code.return(fittedIn(code, { value, type: result.value }, result.into, at));
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
