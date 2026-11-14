/**
 * Places (§3.7, §3.9; docs/arch/definition.md, "Places") as a flow names them (`Place`): a value
 * and the parts into it, which a `write` writes and a call passes by `&`. An element of a
 * container is no part: the flow reads and writes it back through its container's accessors.
 *
 * - A Definition place is a register plus field positions into its value; writing one with a path
 *   is a `store`, building the new value along it, as values are immutable. A register holding a
 *   cell or a reference is read and written through it by the runtime.
 * - What is behind a handle (§3.18) is read with `readCell` and written with `writeCell`: a part of
 *   it is written into its value as it stands then, which is written back.
 * - A field a key of several names reaches is the one the key's value names: a switch on it, each
 *   case reaching its field and the positions past it, the value converted into that field's own
 *   type (`intoKeyedField`), as it is where an instantiation left the key one name.
 * - A place passed by `&` that is no variable's, or is behind a handle, is copied into a cell of its
 *   own and written back once the call returns (copy-in/copy-out).
 * - Appending an item to an array or a `Map` being built builds the next value from the last.
 */

import type {
  Argument as DefinitionArgument,
  Place as DefinitionPlace,
} from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Argument, Operation, Part, Place, ValueId } from '../../checker/surface/flow-ir.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { tupleElements } from '../../checker/types/type/primitives.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { referenceTo } from '../calls/emit-call.ts';
import { eachKeyedField, fittedInto, type KeyedField, writeKeyed } from '../values/keyed-fields.ts';
import { fieldOf } from './parts.ts';
import { cellRegister } from './variables.ts';
import type { FlowWriter } from './writer.ts';

/**
 * Where a place is: a Definition place; positions into the value behind the handle in `cell`; or
 * positions past the field of `within` a key's value names.
 */
type Location =
  | { readonly kind: 'place'; readonly place: DefinitionPlace }
  | { readonly kind: 'behind'; readonly cell: Register; readonly path: readonly number[] }
  | {
      readonly kind: 'keyed';
      readonly within: Location;
      readonly keyed: KeyedField;
      readonly path: readonly number[];
    };

/** A place located, and the type of the value it holds. */
interface Located {
  readonly location: Location;
  readonly type: Type;
}

/** Writes `value` at `place`, or appends it to the array or `Map` being built there. */
export function writePlace(
  writer: FlowWriter,
  { place, value, site }: Extract<Operation, { readonly op: 'write' }>,
): void {
  const { span } = site;
  if (place.path.at(-1)?.kind === 'item') {
    appended(writer, place.root, writer.registerOf(value), span);
    return;
  }
  const { location } = locate(writer, place);
  const source = writer.keyed.get(value);
  if (source === undefined) {
    writeAt(writer, location, writer.registerOf(value), span);
  } else if (location.kind === 'keyed') {
    const { within, keyed, path } = location;
    writeKeyed(
      writer.context,
      { keyed, value: writer.typed(source), site: place.site },
      (_, position, converted) =>
        writeAt(writer, deeper(within, [position, ...path]), converted, span),
    );
  } else {
    const converted = fittedInto(
      writer.context,
      writer.typed(source),
      writer.typeOf(value),
      place.site,
    );
    writeAt(writer, location, converted, span);
  }
}

/**
 * `item` appended to the array in `collection`, or, a key and value pair, to the `Map` there, the
 * next value built from the last.
 */
function appended(writer: FlowWriter, root: ValueId, item: Register, span: AnchoredSpan): void {
  const { code } = writer.context;
  const collection = writer.registerOf(root);
  const spread = { kind: 'spread', value: collection } as const;
  if (writer.maps.has(root)) {
    const [key, value] = [0, 1].map((index) => code.field(item, index, span)) as [
      Register,
      Register,
    ];
    code.emit({
      kind: 'map',
      span,
      dst: collection,
      entries: [spread, { kind: 'entry', key, value }],
    });
  } else {
    code.emit({
      kind: 'array',
      span,
      dst: collection,
      elements: [spread, { kind: 'item', value: item }],
    });
  }
}

/**
 * The arguments `given` passes at `site`: a value as it is, a place by `&`, copied into a cell
 * where it is no variable's; and what writes those copies back, the last first, once the call
 * returns.
 */
export function passedArguments(
  writer: FlowWriter,
  given: readonly Argument[],
  site: NodeOf<string>,
): { readonly arguments: readonly DefinitionArgument[]; readonly leave: () => void } {
  const leaves: (() => void)[] = [];
  const passed = given.map((argument): DefinitionArgument => {
    if (argument.kind === 'value') {
      return { kind: 'value', register: writer.registerOf(argument.value) };
    }
    const { location, type } = locate(writer, argument.place);
    if (location.kind === 'place' && writer.valueOf(argument.place.root).kind === 'variable') {
      return { kind: 'reference', place: location.place };
    }
    if (location.kind === 'keyed') {
      return unreachable(`A key of several fields at ${site.span.from} is passed by '&'.`);
    }
    const cell = cellRegister(writer.context, type);
    writer.context.code.emit({
      kind: 'move',
      span: site.span,
      dst: cell,
      src: readAt(writer, location, site.span),
    });
    leaves.push(() => writeAt(writer, location, cell, site.span));
    return referenceTo(cell);
  });
  const leave = () => {
    for (const each of leaves.toReversed()) {
      each();
    }
  };
  return { arguments: passed, leave };
}

/** Locates `place`: its root's register, then each part into it. */
function locate(writer: FlowWriter, { root, path }: Place): Located {
  const start: Located = {
    location: { kind: 'place', place: { register: writer.registerOf(root), path: [] } },
    type: writer.typeOf(root),
  };
  return path.reduce((located, part) => stepped(writer, located, part), start);
}

/** `located`, then `part` into it: the value behind its handle, a field, an element of a tuple. */
function stepped(writer: FlowWriter, { location, type }: Located, part: Part): Located {
  const { checker } = writer.context;
  const field = (name: string) => {
    const { member, read } = fieldOf(writer, type, name);
    return { location: deeper(location, [read.index]), type: member.type };
  };
  switch (part.kind) {
    case 'behind':
      return location.kind === 'place' && location.place.path.length === 0
        ? {
            location: { kind: 'behind', cell: location.place.register, path: [] },
            type: checker.sharedValueOf(type) ?? unreachable('A handle holds no shape.'),
          }
        : unreachable('A handle is the root of the place behind it.');
    case 'keyed': {
      const key = writer.typed(part.key);
      return key.type.kind === 'literal' && typeof key.type.value === 'string'
        ? field(key.type.value)
        : {
            location: { kind: 'keyed', within: location, keyed: { on: type, key }, path: [] },
            type: checker.typeRules.fieldType(type, key.type),
          };
    }
    case 'step': {
      const { step } = part;
      if (typeof step === 'number') {
        const element = tupleElements(type)?.[step] ?? unreachable(`No element ${step}.`);
        return { location: deeper(location, [step]), type: element };
      }
      return step.kind === 'field'
        ? field(step.name)
        : unreachable(`A place steps into a ${step.kind}.`);
    }
    default:
      return unreachable(`A place reaches a part '${part.kind}' into it.`);
  }
}

/** `location` field `positions` deeper. */
function deeper(location: Location, positions: readonly number[]): Location {
  switch (location.kind) {
    case 'place': {
      const path = [...location.place.path, ...positions];
      return { ...location, place: { ...location.place, path } };
    }
    case 'behind':
    case 'keyed':
      return { ...location, path: [...location.path, ...positions] };
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/** Reads the value at `location` as it stands now. */
function readAt(writer: FlowWriter, location: Location, span: AnchoredSpan): Register {
  const { code } = writer.context;
  switch (location.kind) {
    case 'place':
      return code.readPath(location.place.register, location.place.path, span);
    case 'behind': {
      const value = code.allocate();
      code.emit({ kind: 'readCell', span, dst: value, cell: location.cell });
      return code.readPath(value, location.path, span);
    }
    case 'keyed':
      return unreachable('A field a key of several names names is read by the flow, not here.');
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/** Writes `value` at `location`: behind a handle, into its value as it stands now. */
function writeAt(
  writer: FlowWriter,
  location: Location,
  value: Register,
  span: AnchoredSpan,
): void {
  const { code } = writer.context;
  if (location.kind === 'place') {
    stored(writer, location.place, value, span);
  } else if (location.kind === 'keyed') {
    eachKeyedField(writer.context, location.keyed, span, (_, position) =>
      writeAt(writer, deeper(location.within, [position, ...location.path]), value, span),
    );
  } else if (location.path.length === 0) {
    code.emit({ kind: 'writeCell', span, cell: location.cell, value });
  } else {
    const whole = code.allocate();
    code.emit({ kind: 'readCell', span, dst: whole, cell: location.cell });
    stored(writer, { register: whole, path: [...location.path] }, value, span);
    code.emit({ kind: 'writeCell', span, cell: location.cell, value: whole });
  }
}

/** Writes `value` at `place`: a `move` into its register, or a `store` along its path. */
function stored(
  writer: FlowWriter,
  place: DefinitionPlace,
  value: Register,
  span: AnchoredSpan,
): void {
  if (place.path.length === 0) {
    writer.context.code.emit({ kind: 'move', span, dst: place.register, src: value });
  } else {
    writer.context.code.emit({
      kind: 'store',
      span,
      place: { register: place.register, path: [...place.path] },
      value,
    });
  }
}
