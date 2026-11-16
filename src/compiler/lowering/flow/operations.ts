/**
 * Each operation of a flow as the instructions it is (writer.ts), one writer per kind.
 *
 * - `compute` and `make` build their value with the helpers synthesized code builds with; a
 *   `none` is the constant `null` put in the optional (or union, or `any`) it is made for. What a
 *   construction is built of is moved in, or copied where read again (`CodeWriter.take`).
 * - A struct is built by its fields' names, whatever order its literal gives them in; its
 *   comprehension's parts are the fields its passes visit.
 * - A `copy` out of a variable at a name is the variable's value, read in place; one into the field
 *   a key of several names names converts as the place is written (places.ts); any other is a
 *   move or copy into its own, or the conversion checking fitted. A `read` borrows a part
 *   (parts.ts).
 * - A call's `&` arguments are entered as places; a function value's pack spread passes its
 *   tuple's elements (§3.5). An `onAwait` gets the resolver of its case of the wait being opened
 *   (calls/waits.ts); `await` parks once every case has one, then takes what the future gave.
 * - `keep` copies a held variable's value into its scope's array of its type, then lets go of it
 *   (§7); a scope ending lets go of those arrays instead.
 */

import type { Argument as DefinitionArgument } from '../../../definition/instructions/calls.ts';
import type { Register } from '../../../definition/operands.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type ConstantForm, literalTypeForm } from '../../checker/surface/constant-form.ts';
import type { Argument, Operation } from '../../checker/surface/flow-ir.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import { isPrimitive } from '../../checker/types/type/primitives.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import {
  type ClosedCall,
  calledParameters,
  substitutionOfCall,
} from '../calls/closed-calls.ts';
import { emitCall, emitFunctionCall } from '../calls/emit-call.ts';
import { packElementsOf } from '../calls/packs.ts';
import {
  caseResolver,
  caseValue,
  openWait,
  parked,
  type WaitingMode,
  waitRegisters,
} from '../calls/waits.ts';
import { nestedSpanOf } from '../functions/bodies.ts';
import { constantValue } from '../tables/constants.ts';
import { ownEntryOf } from '../tables/own-entries.ts';
import { equal, negated, ordered } from '../values/operators.ts';
import { noneOf } from '../values/optionals.ts';
import { structValue, tupleOf } from '../values/struct-values.ts';
import { variantAt } from '../values/variant-values.ts';
import { globalRead, partRead } from './parts.ts';
import { passedArguments, writePlace } from './places.ts';
import type { FlowWriter } from './writer.ts';

type Of<Op extends Operation['op']> = Extract<Operation, { readonly op: Op }>;

export const operationWriters: {
  readonly [Op in Operation['op']]: (writer: FlowWriter, operation: Of<Op>) => void;
} = {
  compute: (writer, operation) =>
    writer.define(operation.into, computed(writer, operation), operation.site.span, operation),
  make: (writer, operation) =>
    writer.define(operation.into, made(writer, operation), operation.site.span, operation),
  copy: copied,
  read: (writer, operation) => {
    const { into, from, part, site } = operation;
    const read =
      part.kind === 'given'
        ? writer.givenBy(from, site.span)
        : partRead(writer, { from, into, part }, site);
    writer.define(into, read, site.span, operation);
  },
  write: writePlace,
  call: called,
  callValue: calledValue,
  suspend: (writer, { site, awaited }) => {
    if (site.kind !== 'Await' || awaited.length === 0) {
      return;
    }
    const { code } = writer.context;
    const { span } = site;
    const { open, futures } = writer.takeWait();
    code.letGo([parked(writer.context, writer.waypointAt(site), span)], span);
    futures.forEach((future, position) => {
      writer.give(future, code.copy(caseValue(writer.context, open, position, span), span));
    });
    code.letGo(waitRegisters(open), span);
  },
  keep: (writer, { values, until, site }) => {
    const { code } = writer.context;
    const { span } = site;
    for (const value of values) {
      const list = writer.listOf(until, writer.typeOf(value));
      const longer = code.allocate(code.typeOf(list));
      const item = code.copy(writer.registerOf(value), span);
      code.emit({
        kind: 'array',
        span,
        dst: longer,
        elements: [
          { value: list, spread: true },
          { value: item, spread: false },
        ],
      });
      code.letGo([list], span);
      code.emit({ kind: 'move', span, dst: list, src: longer });
    }
    writer.release(
      values.map((value) => writer.registerOf(value)),
      span,
    );
  },
  release: (writer, { values, site }) => writer.release(writer.registersEnding(values), site.span),
  unknown: ({ flow, context }, { site }) =>
    unreachable(
      `Code checking found a mistake in, a ${site.kind} at ${site.span.from} of module ${context.module} in ${(context as unknown as { frame?: { header?: { name?: string } } }).frame?.header?.name}, is lowered.`,
    ),
};

function computed(
  writer: FlowWriter,
  { into, computation, operands, site }: Of<'compute'>,
): Register {
  const { context } = writer;
  const { span } = site;
  const [first, second] = operands.map((operand) => writer.registerOf(operand));
  switch (computation.kind) {
    case 'constant':
      return constantOf(writer, computation.form, writer.typeOf(into), span);
    case 'equal':
      return equal(context, span, [first as Register, second as Register], computation.negated);
    case 'not':
      return negated(context, first as Register, span);
    case 'order':
      return ordered(context, span, first as Register, computation.relation);
    case 'typeValue': {
      const type = writer.typeOf(into);
      const form = literalTypeForm(type);
      return form === undefined
        ? unreachable(`An instantiation makes ${type.kind} a literal type.`)
        : constantOf(writer, form, type, span);
    }
    default: {
      const unhandled: never = computation;
      return unhandled;
    }
  }
}

/** The constant `form`, of `type`: `null` where `None` is held is `none`. */
function constantOf(
  writer: FlowWriter,
  form: ConstantForm,
  type: Type,
  span: AnchoredSpan,
): Register {
  const { context } = writer;
  const holdsNone = type.kind === 'union' || type.kind === 'any' || isPrimitive(type, 'None');
  return form.kind === 'primitive' && form.value === null && holdsNone
    ? noneOf(context, type, span)
    : context.constant(constantValue(context.tables, form), type, span);
}

function made(writer: FlowWriter, { into, made: what, parts, site }: Of<'make'>): Register {
  const { context } = writer;
  const { code, tables } = context;
  const { span } = site;
  const registers = parts.map((part) => writer.registerOf(part));
  const type = writer.typeOf(into);
  switch (what.kind) {
    case 'struct':
    case 'handle':
      return structMade(writer, type, { fields: what.fields, registers }, span);
    case 'tuple':
      return tupleOf(context, registers, span);
    case 'array': {
      const dst = code.allocate(tables.types.reference(type));
      const elements = registers.map((value, index) =>
        what.spreads.includes(index)
          ? { value, spread: true }
          : { value: code.take(value, span), spread: false },
      );
      code.emit({ kind: 'array', span, dst, elements });
      return dst;
    }
    case 'map': {
      const dst = code.allocate(tables.types.reference(type));
      code.emit({ kind: 'map', span, dst, entries: mapEntries(writer, registers, what.spreads, span) });
      return dst;
    }
    case 'variant': {
      const { type: enumType, variant } = what;
      return enumType.kind === 'nominal'
        ? variantAt(context, { type: enumType, variant, fields: registers }, span)
        : unreachable(`A variant of a ${enumType.kind} type is made.`);
    }
    case 'closure':
      return closureMade(writer, what.function.root, registers, type);
    case 'function': {
      const dst = code.allocate(tables.types.reference(type));
      const callee = tables.callIndex(context.closed(what.call));
      code.emit({ kind: 'closure', span, dst, function: callee, captures: [] });
      return dst;
    }
    default: {
      const unhandled: never = what;
      return unhandled;
    }
  }
}

/** The closure of the nested function `node`, of `type`, carrying `captures` (§3.14). */
function closureMade(
  writer: FlowWriter,
  node: SyntaxNode,
  captures: readonly Register[],
  type: Type,
): Register {
  const { context } = writer;
  const { code } = context;
  if (node.kind !== 'Lambda' && node.kind !== 'FunctionDeclaration') {
    return unreachable(`A closure of a ${node.kind} is made.`);
  }
  const dst = code.allocate(context.tables.types.reference(type));
  const span = nestedSpanOf(context.checker.program, context.module, node);
  const function_ = context.nestedIndex(node);
  const taken = captures.map((capture) => code.take(capture, span));
  code.emit({ kind: 'closure', span, dst, function: function_, captures: taken });
  return dst;
}

/** A `Map`'s entries of `registers`: each spread whole at `spreads`, any other two a pair. */
function mapEntries(
  writer: FlowWriter,
  registers: readonly Register[],
  spreads: readonly number[],
  span: AnchoredSpan,
) {
  const { code } = writer.context;
  const entries: (
    | { kind: 'spread'; value: Register }
    | { kind: 'entry'; key: Register; value: Register }
  )[] = [];
  for (let index = 0; index < registers.length; index += 1) {
    const key = registers[index] as Register;
    if (spreads.includes(index)) {
      entries.push({ kind: 'spread', value: key });
    } else {
      index += 1;
      const value = registers[index] as Register;
      entries.push({ kind: 'entry', key: code.take(key, span), value: code.take(value, span) });
    }
  }
  return entries;
}

/** A struct of `type` made of `registers`, each the field `fields` names (§3.1). */
function structMade(
  writer: FlowWriter,
  type: Type,
  {
    fields,
    registers,
  }: { readonly fields: readonly (string | undefined)[]; readonly registers: readonly Register[] },
  span: AnchoredSpan,
): Register {
  const named = new Map(
    fields.flatMap((name, index) =>
      name === undefined ? [] : [[name, registers[index] as Register] as const],
    ),
  );
  return type.kind === 'nominal' || type.kind === 'anonymous'
    ? structValue(writer.context, type, named, span)
    : unreachable(`A struct of a ${type.kind} type is made.`);
}

function copied(writer: FlowWriter, operation: Of<'copy'>): void {
  const { into, from, fit, site } = operation;
  const source = writer.valueOf(from);
  const { span } = site;
  const { code } = writer.context;
  if (source.kind === 'global') {
    writer.define(into, globalRead(writer, source, span), span, operation);
  } else if (
    fit === undefined &&
    source.kind === 'variable' &&
    writer.valueOf(into).kind === 'temporary'
  ) {
    const register = writer.registerOf(from);
    const through: 'cell' | 'reference' | undefined =
      code.typeOf(register).kind === 'reference' ? 'reference' : source.inCell ? 'cell' : undefined;
    if (through === undefined) {
      writer.alias(into, register);
    } else {
      const read = code.borrow(writer.context.tables.types.reference(writer.typeOf(from)));
      const place = { root: { kind: through, register }, path: [] };
      code.emit({ kind: 'load', span, dst: read, place });
      writer.alias(into, read);
    }
  } else if (fit === 'intoKeyedField') {
    writer.keyed.set(into, from);
  } else if (fit === undefined) {
    writer.define(into, writer.registerOf(from), span, operation);
  } else {
    const converted = writer.context.fitted(
      writer.registerOf(from),
      writer.typeOf(from),
      fit,
      site,
    );
    writer.define(into, converted, span, operation);
  }
}

function called(writer: FlowWriter, operation: Of<'call'>): void {
  const { into, call, role, arguments: given, site } = operation;
  const { context } = writer;
  const { span } = site;
  const closed = context.closed(call);
  const native =
    closed.kind !== 'dispatch' && ownEntryOf(context.checker, closed.instance).kind === 'native';
  const passed = passedArguments(writer, given, { site, native });
  const [future] = given;
  // A case hands its resolver to what it waits on, which keeps it if it is to decide the wait.
  const done = role === 'onAwait' ? awaitedBy(writer, { future, closed }, span) : undefined;
  const arguments_ = done === undefined ? passed.arguments : [...passed.arguments, done];
  const result = context.tables.types.reference(writer.typeOf(into));
  const dst = emitFunctionCall(context, { span, call: closed, arguments: arguments_ }, result);
  passed.leave();
  writer.define(into, dst, span, operation);
  if (done !== undefined) {
    writer.release([done], span);
  }
}

/**
 * The resolver of the case of the wait being opened, or opened now, that waits on `future`
 * (calls/waits.ts).
 */
function awaitedBy(
  writer: FlowWriter,
  { future, closed }: { readonly future: Argument | undefined; readonly closed: ClosedCall },
  span: AnchoredSpan,
): Register {
  if (future?.kind !== 'value') {
    return unreachable(`What an await at ${span.from} waits on is no value.`);
  }
  const { context } = writer;
  const [given, mode] = resolverArguments(writer, closed);
  const open = writer.openedWait(() => openWait(context, mode, span));
  writer.awaiting(future.value);
  return caseResolver(context, open, given, span);
}

/**
 * What a case waits on, of the `Resolver<T, K>` its `onAwait`, `closed`, takes: what its awaitable
 * gives once it settles, `T`, and the kind its wait waits in, `K` (proposal 8, Rule 5), which code
 * that never parks, a `select` with an `else`, has of its awaitable.
 */
function resolverArguments(writer: FlowWriter, closed: ClosedCall): readonly [Type, WaitingMode] {
  const { checker } = writer.context;
  const done = calledParameters(checker, closed)[1]?.type;
  const resolver =
    done === undefined
      ? undefined
      : substitute(done, substitutionOfCall(checker, closed), checker.typeRules);
  const [given, mode] =
    (resolver === undefined
      ? undefined
      : wellKnownArguments(checker, wellKnown.resolver, resolver)) ?? [];
  if (given === undefined || mode?.kind !== 'literal') {
    return unreachable(`An onAwait takes no resolver at ${closed.kind}.`);
  }
  return [given, mode.value === 'ista' ? 'ista' : 'live'];
}

function calledValue(writer: FlowWriter, operation: Of<'callValue'>): void {
  const { into, callee, arguments: given, spreads, site } = operation;
  const { context } = writer;
  const { span } = site;
  const passed = passedArguments(writer, given, { site, native: false });
  const arguments_ = passed.arguments.flatMap((argument, index): DefinitionArgument[] => {
    const value = given[index];
    return spreads.includes(index) && argument.kind === 'value' && value?.kind === 'value'
      ? packElementsOf(context, argument.register, { type: writer.typeOf(value.value), span }).map(
          (register) => ({ kind: 'value', register }),
        )
      : [argument];
  });
  const target = { kind: 'value', register: writer.registerOf(callee) } as const;
  const result = context.tables.types.reference(writer.typeOf(into));
  const dst = emitCall(context, { span, callee: target, arguments: arguments_ }, result);
  passed.leave();
  writer.define(into, dst, span, operation);
}
