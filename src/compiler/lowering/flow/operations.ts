/**
 * Each operation of a flow as the instructions it is (writer.ts), one writer per kind.
 *
 * - `compute` and `make` build their value with the helpers synthesized code builds with; a
 *   `none` is the constant `null` put in the optional (or union, or `any`) it is made for.
 * - A struct is built by its fields' names, whatever order its literal gives them in; its
 *   comprehension's parts are the fields its passes visit.
 * - A `copy` out of a variable at a name is the variable's value; one into the field a key of
 *   several names names converts as the place is written (places.ts); any other is a `move`, or
 *   the conversion checking fitted. A `read` reads a part (parts.ts).
 * - A call's `&` arguments are entered as places; a function value's pack spread passes its
 *   tuple's elements (§3.5). An `onAwait` gets the wait's resolver for its case (calls/waits.ts);
 *   the codec of an instance's outcome is the runtime's to call, named by its type entry.
 * - `keep` keeps a held variable's value in its scope's list, then lets go of it (§7); a scope
 *   ending releases that list instead.
 */

import type { Argument as DefinitionArgument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ConstantForm } from '../../checker/surface/constant-form.ts';
import type { Argument, Operation } from '../../checker/surface/flow-ir.ts';
import { argumentsInOrder } from '../../checker/surface/resolved-call.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { isPrimitive } from '../../checker/types/type/primitives.ts';
import type { CallingNode } from '../../syntax/expressions/calls.ts';
import type { FieldHeader } from '../../syntax/expressions/index.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { emitCall, emitFunctionCall } from '../calls/emit-call.ts';
import { packElementsOf } from '../calls/packs.ts';
import { awaitWait } from '../calls/waits.ts';
import { nestedSpanOf } from '../functions/bodies.ts';
import { constantValue } from '../tables/constants.ts';
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
    writer.define(operation.into, computed(writer, operation), operation.site.span),
  make: (writer, operation) =>
    writer.define(operation.into, made(writer, operation), operation.site.span),
  copy: copied,
  read: (writer, { into, from, part, site }) =>
    part.kind === 'given'
      ? writer.bind(into, writer.givenBy(from, site.span))
      : writer.define(into, partRead(writer, { from, into, part }, site), site.span),
  write: writePlace,
  call: called,
  callValue: calledValue,
  suspend: (writer, { site, awaited: [future] }) => {
    if (site.kind !== 'Await' || future === undefined) {
      return;
    }
    const { code } = writer.context;
    const wait = writer.takeWait();
    code.withWaypoint(writer.waypointAt(site), () =>
      writer.give(future, awaitWait(writer.context, wait.wait, site.span)),
    );
  },
  keep: (writer, { values, until, site }) => {
    const registers = values.map((value) => writer.registerOf(value));
    const into = writer.listOf(until);
    writer.context.code.emit({ kind: 'keep', span: site.span, registers, into });
    writer.release(registers, site.span);
  },
  release: (writer, { values, site }) => writer.release(writer.registersEnding(values), site.span),
  unknown: ({ flow }) =>
    unreachable(`Code checking found a mistake in at ${flow.root.span.from} is lowered.`),
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
    case 'fieldKey':
      return context.constant(fieldOf(writer, computation.header), span);
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
    : context.constant(constantValue(context.tables, form), span);
}

/** The field the pass of the loop `header` heads, being written, visits. */
function fieldOf(writer: FlowWriter, header: FieldHeader): string {
  const visit = writer.passesHere().find((each) => each.header === header);
  return visit?.field ?? unreachable(`A field key at ${header.span.from} is outside its loop.`);
}

function made(writer: FlowWriter, { into, made: what, parts, site }: Of<'make'>): Register {
  const { context } = writer;
  const { code } = context;
  const { span } = site;
  const registers = parts.map((part) => writer.registerOf(part));
  const dst = code.allocate();
  switch (what.kind) {
    case 'struct':
    case 'handle':
      return structMade(writer, { type: writer.typeOf(into), site, registers });
    case 'tuple':
      return tupleOf(context, registers, span);
    case 'array': {
      const elements = registers.map((value, index) =>
        what.spreads.includes(index)
          ? ({ kind: 'spread', value } as const)
          : ({ kind: 'item', value } as const),
      );
      code.emit({ kind: 'array', span, dst, elements });
      return dst;
    }
    case 'map':
      writer.maps.add(into);
      code.emit({ kind: 'map', span, dst, entries: mapEntries(registers, what.spreads) });
      return dst;
    case 'variant': {
      const { type, variant } = what;
      return type.kind === 'nominal'
        ? variantAt(context, { type, variant, fields: registers }, span)
        : unreachable(`A variant of a ${type.kind} type is made.`);
    }
    case 'closure':
      return closureMade(writer, what.function.root, registers);
    case 'function': {
      const callee = context.tables.callIndex(context.closed(what.call));
      code.emit({ kind: 'closure', span, dst, function: callee, captures: [] });
      return dst;
    }
    default: {
      const unhandled: never = what;
      return unhandled;
    }
  }
}

/** The closure of the nested function `node`, carrying `captures` (§3.14). */
function closureMade(
  writer: FlowWriter,
  node: SyntaxNode,
  captures: readonly Register[],
): Register {
  const { context } = writer;
  if (node.kind !== 'Lambda' && node.kind !== 'FunctionDeclaration') {
    return unreachable(`A closure of a ${node.kind} is made.`);
  }
  const dst = context.code.allocate();
  const span = nestedSpanOf(context.checker.program, context.module, node);
  const function_ = context.nestedIndex(node);
  context.code.emit({ kind: 'closure', span, dst, function: function_, captures: [...captures] });
  return dst;
}

/** A `Map`'s entries of `registers`: each spread whole at `spreads`, any other two a pair. */
function mapEntries(registers: readonly Register[], spreads: readonly number[]) {
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
      entries.push({ kind: 'entry', key, value: registers[index] as Register });
    }
  }
  return entries;
}

/**
 * A struct of `type` made of `registers`, at `site`: a literal's fields from its sources (§3.1), a
 * comprehension's the fields its passes visit, in their order; a bare struct none.
 */
function structMade(
  writer: FlowWriter,
  {
    type,
    site,
    registers,
  }: {
    readonly type: Type;
    readonly site: NodeOf<string>;
    readonly registers: readonly Register[];
  },
): Register {
  const { body } = writer.context;
  const sources =
    site.kind === 'StructLiteral' || site.kind === 'NewStructLiteral'
      ? (body.sourcesOf(site as never) ?? [])
      : [];
  const names = sources.flatMap((source) =>
    source.kind === 'comprehension'
      ? body
          .passesOf(source.comprehension.header)
          .map(({ visits }) => (visits.kind === 'field' ? visits.name : undefined))
      : [source.field],
  );
  const named = new Map(
    names.flatMap((name, index) =>
      name === undefined ? [] : [[name, registers[index] as Register] as const],
    ),
  );
  if (type.kind !== 'nominal' && type.kind !== 'anonymous') {
    return unreachable(`A struct of a ${type.kind} type is made.`);
  }
  return structValue(writer.context, type, named, site.span);
}

function copied(writer: FlowWriter, { into, from, fit, site }: Of<'copy'>): void {
  const source = writer.valueOf(from);
  const { span } = site;
  if (source.kind === 'global') {
    writer.define(into, globalRead(writer, source, span), span);
  } else if (
    fit === undefined &&
    source.kind === 'variable' &&
    writer.valueOf(into).kind === 'temporary'
  ) {
    writer.bind(into, writer.registerOf(from));
  } else if (fit === 'intoKeyedField') {
    writer.keyed.set(into, from);
  } else if (fit === undefined) {
    writer.define(into, writer.registerOf(from), span);
  } else {
    const converted = writer.context.fitted(
      writer.registerOf(from),
      writer.typeOf(from),
      fit,
      site,
    );
    writer.define(into, converted, span);
  }
}

function called(
  writer: FlowWriter,
  { into, call, role, arguments: given, site }: Of<'call'>,
): void {
  const { context } = writer;
  const { span } = site;
  if (role === 'encodeOutcome') {
    return;
  }
  const passed = passedArguments(writer, given, site);
  const [future] = given;
  // A case hands its resolver to what it waits on, which keeps it if it is to decide the wait.
  const done = role === 'onAwait' ? awaitedBy(writer, future, span) : undefined;
  const arguments_ = done === undefined ? passed.arguments : [...passed.arguments, done];
  const dst = emitFunctionCall(context, {
    span,
    call: context.closed(call),
    arguments: arguments_,
  });
  passed.leave();
  writer.define(into, dst, span);
  if (done !== undefined) {
    writer.release([done.register], span);
  }
}

/** The resolver of the case of the wait being opened that waits on `future` (calls/waits.ts). */
function awaitedBy(
  writer: FlowWriter,
  future: Argument | undefined,
  span: AnchoredSpan,
): { readonly kind: 'value'; readonly register: Register } {
  if (future?.kind !== 'value') {
    return unreachable(`What an await at ${span.from} waits on is no value.`);
  }
  const wait = writer.openWait(span);
  const register = writer.context.code.resolver(wait.wait, wait.futures.length, span);
  wait.futures.push(future.value);
  return { kind: 'value', register };
}

function calledValue(
  writer: FlowWriter,
  { into, callee, arguments: given, site }: Of<'callValue'>,
): void {
  const { context } = writer;
  const { span } = site;
  // A function value's call is checked at the node calling it.
  const binding = context.body.valueCalls.get(site as CallingNode)?.binding;
  const spreads =
    binding === undefined ? [] : argumentsInOrder(binding).map(({ isSpread }) => isSpread);
  const passed = passedArguments(writer, given, site);
  const arguments_ = passed.arguments.flatMap((argument, index): DefinitionArgument[] =>
    spreads[index] === true && argument.kind === 'value' && given[index]?.kind === 'value'
      ? packElementsOf(context, argument.register, {
          type: writer.typeOf(given[index].value),
          span,
        }).map((register) => ({ kind: 'value', register }))
      : [argument],
  );
  const dst = emitCall(context, {
    span,
    callee: { kind: 'value', register: writer.registerOf(callee) },
    arguments: arguments_,
  });
  passed.leave();
  writer.define(into, dst, span);
}
