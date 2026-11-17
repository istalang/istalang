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

import type { Argument } from '../../../../definition/instructions/calls.ts';
import type { FunctionId, Register } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import type { TypeReference } from '../../../../definition/tables/types.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { MemberConversion } from '../../../checker/check.ts';
import { type Fit, singleElement } from '../../../checker/types/fitting/fit/index.ts';
import { resultFitBetween } from '../../../checker/types/fitting/part-pairs.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type { FunctionType, StructValueType, Type } from '../../../checker/types/type/index.ts';
import { membersOf } from '../../../checker/types/type/index.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall } from '../../calls/emit-call.ts';
import type { CodeContext, FunctionContext, Lowering, TypedValue } from '../../context.ts';
import { SynthesizedCode } from '../../synthesized/index.ts';
import {
  type BodyOwner,
  type ConversionEntry,
  type ConversionSite,
  conversionName,
  ownerDeclaration,
} from '../../tables/instances.ts';
import { tableKey } from '../../tables/names.ts';
import { parameterTypeOf } from '../../tables/parameter-types.ts';
import { convertedIntoAny } from '../../values/into-any.ts';
import { rebuiltAs, tupleOf } from '../../values/struct-values.ts';
import { asBase, intoUnion } from '../../values/unions.ts';
import { builtKindOf, codeModeOf } from '../modes.ts';
import { changesLayout, convertedFuture, type Rebuilding, rebuilt } from './parts.ts';

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
  typed: TypedValue,
  fit: Fit,
  { owner, site }: FittingSite,
): Register {
  const module = context.checker.moduleOf(ownerDeclaration(owner));
  return appliedFit(context, typed, fit, { span: site.span, at: { module, span: site.span } });
}

/** `typed`, made to fit as `fit` says: converted, then put into a union. */
function appliedFit(context: CodeContext, typed: TypedValue, fit: Fit, how: Applying): Register {
  const converted = convertedValue(context, typed, fit.conversion, how);
  return fit.into === undefined
    ? converted.register
    : intoUnion(
        context,
        { register: converted.register, type: fit.into.member ?? converted.type },
        fit.into.union,
        how.span,
      );
}

function convertedValue(
  context: CodeContext,
  typed: TypedValue,
  conversion: Fit['conversion'],
  how: Applying,
): TypedValue {
  const { span } = how;
  switch (conversion.kind) {
    case 'none':
      return typed;
    case 'any': {
      const { to } = conversion;
      const value = convertedIntoAny(
        context,
        { value: typed.register, from: typed.type, to },
        span,
      );
      return { register: value, type: to };
    }
    case 'async': {
      const { to } = conversion;
      const from = functionTypeOf(typed.type);
      return { register: wrappedClosure(context, typed.register, { from, to }, how), type: to };
    }
    case 'shape': {
      const { to } = conversion;
      const from = structTypeOf(typed.type);
      return { register: rebuiltAs(context, typed.register, { from, to }, span), type: to };
    }
    case 'tupled':
      return {
        register: tupleOf(context, [typed.register], span),
        type: { kind: 'tuple', elements: [typed.type] },
      };
    case 'base': {
      return { register: asBase(context, typed, span), type: baseOfAll(typed.type) };
    }
    case 'untupled': {
      const element = singleElement(typed.type);
      if (element === undefined) {
        unreachable('Only a one-element tuple is untupled.');
      }
      const reference = context.tables.types.reference(element);
      return {
        register: context.code.tupleItem(typed.register, 0, reference, span),
        type: element,
      };
    }
    case 'parts': {
      const { to } = conversion;
      return { register: partsConverted(context, typed, to, how), type: to };
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
  typed: TypedValue,
  to: Type,
  how: Applying,
): Register {
  const { checker, tables } = context;
  if (!changesLayout(checker, typed.type, to)) {
    return typed.register;
  }
  const from = unfolded(typed.type);
  const target = unfolded(to);
  if (from.kind === 'function' && target.kind === 'function') {
    return wrappedClosure(context, typed.register, { from, to: target }, how);
  }
  const entry = tables.index({ kind: 'converting', from: typed.type, to, at: how.at });
  return emitCall(
    context,
    { span: how.span, callee: entry, arguments: [typed.register] },
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
  const entry = context.tables.index({ kind: 'wrapping', from, to, at });
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
  typed: TypedValue,
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
    converted: (part, to) => appliedFit(code, part, fitBetween(code, part.type, to), how),
    converter: (from, to) =>
      closureOf(
        code,
        { entry: tables.index({ kind: 'converting', from, to, at }), captures: [] },
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
  lowering: Lowering,
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
  const typed = { register: value, type: from };
  const result =
    fit.conversion.kind === 'parts' && fit.into === undefined
      ? rebuilt(code, typed, to, rebuildingIn(code, how))
      : appliedFit(code, typed, fit, how);
  code.return(result);
  return code.entry(tables.headerAt(conversionName(checker, entry), at.module, at.span));
}

/**
 * The entry of a function of type `entry.from` wrapped as one of `entry.to` (§3.5, §3.14): it
 * converts each argument it is given into what the function takes, a `&` passed on as it is,
 * calls the function it captures, and converts what it gives. Where `to` gives a future of what a
 * plain function gives, the entry is async, so it gives a future already resolved; a future the
 * function gives is converted as it is (`convertedFuture`), so the entry starts no call of its own
 * and the function's call is the caller's. The Definition marks it `wrapping`, so a start of it
 * starts the function it wraps (§10).
 */
export function wrappingEntry(
  lowering: Lowering,
  entry: Extract<ConversionEntry, { readonly kind: 'wrapping' }>,
): CodeFunction {
  const { checker, tables } = lowering;
  const { from, to, at } = entry;
  const resultFit = resultFitBetween(checker, from, to);
  const async = resultFit.kind === 'resolved';
  const code = new SynthesizedCode(lowering, at.span, {
    parameters: to.parameters.map((parameter) => parameterTypeOf(tables.types, parameter)),
    captures: [tables.types.reference(from)],
    result: tables.types.reference(async ? resultFit.into : to.result),
    mode: codeModeOf(async, builtKindOf(checker, entry.to)),
  });
  const [original] = code.captures;
  if (original === undefined) {
    unreachable('A wrapped function captures the function it calls.');
  }
  const passed = fittedArguments(code, { called: to, met: from }, at);
  const called = emitCall(
    code,
    { span: at.span, callee: { kind: 'value', register: original }, arguments: passed },
    tables.types.reference(from.result),
  );
  code.return(returnedAs(code, called, entry, at));
  const header = tables.headerAt(conversionName(checker, entry), at.module, at.span);
  return { ...code.entry(header), wrapping: true };
}

/**
 * `called`, what a function of type `from` gave, as a function of type `to` returns it: fitted to
 * its result; a future converted as it is; a plain value as an async entry gives it, in the future
 * it resolves.
 */
function returnedAs(
  code: SynthesizedCode,
  called: Register,
  { from, to }: { readonly from: FunctionType; readonly to: FunctionType },
  at: ConversionSite,
): Register {
  const result = resultFitBetween(code.checker, from, to);
  if (result.kind !== 'awaited') {
    return fittedResult(code, called, { met: from, called: to }, at);
  }
  const how = rebuildingIn(code, applyingIn(at));
  const { value, into } = result;
  return convertedFuture(code, called, { value, into, type: to.result }, how);
}

/**
 * What an entry standing for a call of `called` passes on, from its parameters past the first
 * `skipped`, to a function of type `met`: each fitted into what `met` takes as the checker fits
 * them, a `&` passed on as it is, since it never converts.
 */
export function fittedArguments(
  code: SynthesizedCode,
  { called, met }: MemberConversion<FunctionType | undefined>,
  at: ConversionSite,
  skipped = 0,
): Argument[] {
  return code.parameters.slice(skipped).map((value, offset) => {
    const index = skipped + offset;
    const given = called?.parameters[index];
    const taken = met?.parameters[index];
    if (given === undefined || taken === undefined || given.reference) {
      return code.passedOn(index);
    }
    return {
      kind: 'value',
      register: fittedIn(code, { register: value, type: given.type }, taken.type, at),
    };
  });
}

/**
 * `result`, what a function of type `met` gave, converted into what a call of `called` gives, as
 * the checker fits the two functions' results: a future's value where the call awaited it already.
 */
export function fittedResult(
  code: SynthesizedCode,
  result: Register,
  { met, called }: MemberConversion<FunctionType>,
  at: ConversionSite,
): Register {
  const fit = resultFitBetween(code.checker, met, called);
  return fit.kind === 'value'
    ? fittedIn(code, { register: result, type: met.result }, called.result, at)
    : fittedIn(code, { register: result, type: fit.value }, fit.into, at);
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
