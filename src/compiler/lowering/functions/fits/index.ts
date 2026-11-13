/**
 * A value made to fit where the checker found it fits (§2, checker/types/fitting/fit/index.ts):
 * converted once, into an `any` type, a struct's value rebuilt as its shape (§3.1), a plain
 * function made async, or between a one-element tuple and its element, or a literal taken as its
 * base, then put into a union where the fit says. The checker records the fit per value, so this is
 * the one place lowering acts on it, and no handler needs to know about conversions. A value
 * converted part by part (§3.5) is rebuilt by the entry of its pair of types where its layout
 * changes (parts.ts), each part fitted as the checker fits it.
 *
 * A plain function value made async where an async function is expected (§3.14) becomes a closure
 * capturing the plain value, whose entry is async and calls it with the arguments it is given. So
 * calling the closure starts an async function that returns at once, which gives a future already
 * resolved, and never suspends. The entry is one per site in a body's instance, so a trace through
 * it points at where the value was made async. Inside a conversion's entry, which serves every site
 * its pair is met at, a function is made async as any function converted part by part is: wrapped
 * by the entry of its pair.
 */

import type { FunctionId, Register } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { ValueSite } from '../../../checker/surface/checked-body.ts';
import { type Fit, singleElement } from '../../../checker/types/fitting/fit/index.ts';
import { resultFitBetween } from '../../../checker/types/fitting/part-pairs.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type { FunctionType, StructValueType, Type } from '../../../checker/types/type/index.ts';
import { membersOf } from '../../../checker/types/type/index.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall } from '../../calls/emit-call.ts';
import { tupleOf } from '../../constructs/expressions/literals/tuples.ts';
import type { CodeContext, FunctionContext } from '../../context.ts';
import { SynthesizedCode } from '../../synthesized/index.ts';
import {
  type AsyncFit,
  type BodyOwner,
  type ConversionEntry,
  type ConversionSite,
  conversionName,
  ownerDeclaration,
} from '../../tables/instances.ts';
import { spelledType } from '../../tables/names.ts';
import { convertedIntoAny } from '../../values/into-any.ts';
import { rebuiltAs } from '../../values/struct-values.ts';
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
  readonly site: ValueSite;
}

/**
 * How a fit is made where it is: the span its code points at, where an entry a conversion of parts
 * needs is named, and how a plain function is made async there.
 */
interface Applying {
  readonly span: AnchoredSpan;
  readonly at: ConversionSite;
  readonly madeAsync: (value: Register, plain: FunctionType, to: FunctionType) => Register;
}

/** `typed`, as the checker fitted it at `where`: converted, then put into a union. */
export function fittedValue(
  context: FunctionContext,
  typed: TypedRegister,
  fit: Fit,
  { owner, site }: FittingSite,
): Register {
  const module = context.checker.moduleOf(ownerDeclaration(owner));
  return appliedFit(context, typed, fit, {
    span: site.span,
    at: { module, span: site.span },
    madeAsync: (value, plain, made) =>
      asyncFitClosure(context, { owner, site, type: plain, made }, value),
  });
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
      return { value: how.madeAsync(typed.value, functionTypeOf(typed.type), to), type: to };
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
      return { value: context.code.field(typed.value, 0, span), type: element };
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
    const entry = tables.conversionIndex({ kind: 'wrapping', from, to: target, at: how.at });
    return closureOf(context, entry, [typed.value], how.span);
  }
  const entry = tables.conversionIndex({ kind: 'converting', from: typed.type, to, at: how.at });
  return emitCall(context, { span: how.span, callee: entry, arguments: [typed.value] });
}

/** A closure of `entry`, capturing `captures`. */
function closureOf(
  context: CodeContext,
  entry: FunctionId,
  captures: readonly Register[],
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [...captures] });
  return dst;
}

/**
 * How fits are made inside a conversion's entry: where its pair was first met, a plain function
 * made async by wrapping it, as any function converted part by part is.
 */
function applyingIn(code: SynthesizedCode, at: ConversionSite): Applying {
  return {
    span: at.span,
    at,
    madeAsync: (value, plain, to) => {
      const entry = code.tables.conversionIndex({ kind: 'wrapping', from: plain, to, at });
      return closureOf(code, entry, [value], at.span);
    },
  };
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
  return appliedFit(code, typed, fitBetween(code, typed.type, to), applyingIn(code, at));
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
      closureOf(code, tables.conversionIndex({ kind: 'converting', from, to, at }), [], span),
    wrapped: (value, from, to) =>
      closureOf(code, tables.conversionIndex({ kind: 'wrapping', from, to, at }), [value], span),
  };
}

/** The fit of a value of `from` where `to` is expected, which the checker found before. */
function fitBetween(context: Pick<CodeContext, 'checker'>, from: Type, to: Type): Fit {
  return (
    context.checker.fitOf(from, to) ??
    unreachable(`A part converted into ${spelledType(context.checker, to)} fits it.`)
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
  const code = new SynthesizedCode(lowering, at.span, 1);
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A conversion takes the value it converts.');
  }
  const how = applyingIn(code, at);
  const fit = fitBetween(code, from, to);
  const result =
    fit.conversion.kind === 'parts' && fit.into === undefined
      ? rebuilt(code, { register: value, type: from }, to, rebuildingIn(code, how))
      : appliedFit(code, { value, type: from }, fit, how);
  code.return(result);
  return code.entry(tables.headerAt(conversionName(checker, entry), at.module, at.span), 'simple');
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
  const references = to.parameters.map((parameter) => parameter.reference);
  const code = new SynthesizedCode(lowering, at.span, references.length, 1);
  const [original] = code.captures;
  if (original === undefined) {
    unreachable('A wrapped function captures the function it calls.');
  }
  const passed = code.parameters.map((parameter, index) => {
    const taken = to.parameters[index];
    const own = from.parameters[index];
    if (taken === undefined || own === undefined || taken.reference) {
      return code.passedOn(index, references);
    }
    const register = fittedIn(code, { value: parameter, type: taken.type }, own.type, at);
    return { kind: 'value' as const, register };
  });
  const called = emitCall(code, {
    span: at.span,
    callee: { kind: 'value', register: original },
    arguments: passed,
  });
  const mode = codeModeOf(returnedAs(code, called, entry, at), builtKindOf(checker, entry.to));
  const header = tables.headerAt(conversionName(checker, entry), at.module, at.span);
  return code.entry(header, mode, references);
}

/**
 * Returns `called`, what a function of type `from` gave, as a function of type `to` gives it:
 * fitted to its result; where `to` gives a future of it, from an async entry, awaiting the future
 * `from` gave, if any, so the entry gives a future already resolved when `from` gives none. Whether
 * the entry is async.
 */
export function returnedAs(
  code: SynthesizedCode,
  called: Register,
  { from, to }: { readonly from: FunctionType; readonly to: FunctionType },
  at: ConversionSite,
): boolean {
  const result = resultFitBetween(code.checker, from, to);
  if (result.kind === 'value') {
    code.return(fittedIn(code, { value: called, type: from.result }, to.result, at));
    return false;
  }
  const value = result.kind === 'awaited' ? code.await(called, from.result) : called;
  code.return(fittedIn(code, { value, type: result.value }, result.into, at));
  return true;
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
function asyncFitClosure(context: CodeContext, fit: AsyncFit, value: Register): Register {
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
  const mode = codeModeOf(true, builtKindOf(context.checker, fit.made));
  return code.entry(context.tables.asyncFitHeader(fit), mode, references);
}
