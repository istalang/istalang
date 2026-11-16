/**
 * Places (§3.7, §3.9; docs/arch/definition.md, "Places") as a flow names them (`Place`): a value
 * and the parts into it, which a `write` writes and a call passes by `&`. An element of a container
 * is no part: the flow reads and writes it back through its container's accessors.
 *
 * - A Definition place is a root, how it is reached, and the steps into its value: a variable's
 *   register, the cell a captured or `&`-passed variable lives in, the cell behind a shared struct's
 *   handle (§3.18), or the place a `&` parameter refers to. A write is a `store`, in place where
 *   nothing else holds the values along it.
 * - A field a key of several names reaches is the one the key's value names: a switch on it, each
 *   case reaching its field and the steps past it, the value converted into that field's own type
 *   (`intoKeyedField`), as it is where an instantiation left the key one name.
 * - A place passed by `&` that no cell or reference roots, or that is behind a handle and passed to
 *   code, is copied into a cell of its own and written back once the call returns (copy-in/copy-
 *   out, §3.7): code could read the handle's value meanwhile, which still holds the old one.
 * - Appending an item to an array or a `Map` being built changes it in place where nothing else
 *   holds it (`append`, `appendEntry`).
 */

import type { Argument as DefinitionArgument } from '../../../definition/instructions/calls.ts';
import type {
  Place as DefinitionPlace,
  PlaceStep,
} from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Argument, Operation, Part, Place, ValueId } from '../../checker/surface/flow-ir.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { tupleElements } from '../../checker/types/type/primitives.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { referenceTo } from '../calls/emit-call.ts';
import { eachKeyedField, fittedInto, type KeyedField, writeKeyed } from '../values/keyed-fields.ts';
import { fieldOf } from './parts.ts';
import type { FlowWriter } from './writer.ts';

/**
 * Where a place is: a Definition place (`place`), whether behind a handle; or steps past the field
 * of `within` a key's value names.
 */
type Location =
  | { readonly kind: 'place'; readonly place: DefinitionPlace; readonly behind: boolean }
  | {
      readonly kind: 'keyed';
      readonly within: Location;
      readonly keyed: KeyedField;
      readonly path: readonly PlaceStep[];
    };

/** A place located, and the type of the value it holds. */
interface Located {
  readonly location: Location;
  readonly type: Type;
}

/** Writes `value` at `place`, or appends it to the array or `Map` being built there. */
export function writePlace(
  writer: FlowWriter,
  operation: Extract<Operation, { readonly op: 'write' }>,
): void {
  const { place, value, site } = operation;
  const { span } = site;
  if (place.path.at(-1)?.kind === 'item') {
    appended(writer, place.root, writer.registerOf(value), span);
    return;
  }
  const root = writer.valueOf(place.root);
  const throughReference =
    writer.context.code.typeOf(writer.registerOf(place.root)).kind === 'reference';
  if (
    place.path.length === 0 &&
    root.kind === 'variable' &&
    !throughReference &&
    writer.keyed.get(value) === undefined
  ) {
    writer.define(place.root, writer.registerOf(value), span, operation);
    return;
  }
  const { location } = locate(writer, place, span);
  const source = writer.keyed.get(value);
  if (source === undefined) {
    writeAt(writer, location, writer.registerOf(value), span);
  } else if (location.kind === 'keyed') {
    const { within, keyed, path } = location;
    writeKeyed(
      writer.context,
      { keyed, value: writer.typed(source), site: place.site },
      (_, position, converted) =>
        writeAt(
          writer,
          deeper(within, [{ kind: 'field', field: position }, ...path]),
          converted,
          span,
        ),
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
 * `item` appended to the array in `collection`, or, a key and value pair, to the `Map` there, in
 * place where nothing else holds it.
 */
function appended(writer: FlowWriter, root: ValueId, item: Register, span: AnchoredSpan): void {
  const { code, checker, tables } = writer.context;
  const collection = writer.registerOf(root);
  const type = writer.typeOf(root);
  const entries = wellKnownArguments(checker, wellKnown.map, type);
  if (entries === undefined) {
    code.emit({ kind: 'append', span, dst: collection, collection, item: code.take(item, span) });
  } else {
    const [keyType, valueType] = entries.map((each) => tables.types.reference(each));
    const key = code.copy(
      code.tupleItem(item, 0, keyType ?? unreachable('A key type.'), span),
      span,
    );
    const value = code.copy(
      code.tupleItem(item, 1, valueType ?? unreachable('A value type.'), span),
      span,
    );
    code.emit({ kind: 'appendEntry', span, dst: collection, collection, key, value });
  }
}

/**
 * The arguments `given` passes at `site` to a native or to code: a value as it is, a place by `&`
 * as a reference, copied into a cell where no cell or reference roots it, or where it is behind a
 * handle and passed to code; and what writes those copies back, the last first, once the call
 * returns.
 */
export function passedArguments(
  writer: FlowWriter,
  given: readonly Argument[],
  { site, native }: { readonly site: NodeOf<string>; readonly native: boolean },
): { readonly arguments: readonly DefinitionArgument[]; readonly leave: () => void } {
  const { code, tables } = writer.context;
  const { span } = site;
  const leaves: (() => void)[] = [];
  const passed = given.map((argument): DefinitionArgument => {
    if (argument.kind === 'value') {
      return { kind: 'value', register: writer.registerOf(argument.value) };
    }
    const { location, type } = locate(writer, argument.place, span);
    if (location.kind === 'keyed') {
      return unreachable(`A key of several fields at ${span.from} is passed by '&'.`);
    }
    const reference = tables.types.reference(type);
    const rooted = location.place.root.kind !== 'register';
    if (rooted && (!location.behind || native)) {
      const dst = code.borrow({ kind: 'reference', to: reference });
      code.emit({ kind: 'reference', span, dst, place: location.place });
      return { kind: 'value', register: dst };
    }
    const cellType = tables.types.reference(writer.context.checker.cellOf(type));
    const cell = code.allocate(cellType);
    const current = loadAt(writer, location.place, type, span);
    code.emit({ kind: 'newCell', span, dst: cell, value: current });
    leaves.push(() => {
      writeAt(
        writer,
        location,
        loadAt(writer, { root: { kind: 'cell', register: cell }, path: [] }, type, span),
        span,
      );
      code.letGo([cell], span);
    });
    return { kind: 'value', register: referenceTo(writer.context, cell, reference, span) };
  });
  const leave = () => {
    for (const each of leaves.toReversed()) {
      each();
    }
  };
  return { arguments: passed, leave };
}

/**
 * What a place rooted at `value` is rooted at: the reference its register holds, the cell a captured
 * or `&`-passed variable lives in, or its register.
 */
export function rootKindOf(writer: FlowWriter, value: ValueId): DefinitionPlace['root']['kind'] {
  if (writer.context.code.typeOf(writer.registerOf(value)).kind === 'reference') {
    return 'reference';
  }
  const known = writer.valueOf(value);
  return known.kind === 'variable' && known.inCell ? 'cell' : 'register';
}

/** Locates `place`, entered at `span`: its root, then each part into it. */
function locate(writer: FlowWriter, { root, path }: Place, span: AnchoredSpan): Located {
  const register = writer.registerOf(root);
  const start: Located = {
    location: {
      kind: 'place',
      place: { root: { kind: rootKindOf(writer, root), register }, path: [] },
      behind: false,
    },
    type: writer.typeOf(root),
  };
  return path.reduce((located, part) => stepped(writer, located, part, span), start);
}

/** `located`, then `part` into it: the value behind its handle, a field, an element of a tuple. */
function stepped(
  writer: FlowWriter,
  { location, type }: Located,
  part: Part,
  span: AnchoredSpan,
): Located {
  const { checker } = writer.context;
  const field = (name: string) => {
    const { member, read } = fieldOf(writer, type, name);
    return {
      location: deeper(location, [{ kind: 'field', field: read.index }]),
      type: member.type,
    };
  };
  switch (part.kind) {
    case 'behind': {
      if (location.kind !== 'place') {
        return unreachable('A handle is no field a key names.');
      }
      const handle =
        location.place.path.length === 0 && location.place.root.kind === 'register'
          ? location.place.root.register
          : loadAt(writer, location.place, type, span);
      return {
        location: {
          kind: 'place',
          place: { root: { kind: 'cell', register: handle }, path: [] },
          behind: true,
        },
        type: checker.sharedValueOf(type) ?? unreachable('A handle holds no shape.'),
      };
    }
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
        return { location: deeper(location, [{ kind: 'tuple', index: step }]), type: element };
      }
      return step.kind === 'field'
        ? field(step.name)
        : unreachable(`A place steps into a ${step.kind}.`);
    }
    default:
      return unreachable(`A place reaches a part '${part.kind}' into it.`);
  }
}

/** `location`, `steps` deeper. */
function deeper(location: Location, steps: readonly PlaceStep[]): Location {
  switch (location.kind) {
    case 'place':
      return {
        ...location,
        place: { ...location.place, path: [...location.place.path, ...steps] },
      };
    case 'keyed':
      return { ...location, path: [...location.path, ...steps] };
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/** A fresh register owning another holder of the value of `type` at `place`, as it stands now. */
function loadAt(
  writer: FlowWriter,
  place: DefinitionPlace,
  type: Type,
  span: AnchoredSpan,
): Register {
  const { code, tables } = writer.context;
  if (place.root.kind === 'register' && place.path.length === 0) {
    return code.copy(place.root.register, span);
  }
  const dst = code.allocate(tables.types.reference(type));
  code.emit({ kind: 'load', span, dst, place });
  return dst;
}

/** Writes `value` at `location`: behind a handle, into its value as it stands now. */
function writeAt(
  writer: FlowWriter,
  location: Location,
  value: Register,
  span: AnchoredSpan,
): void {
  if (location.kind === 'keyed') {
    // Each case writes the value, so none moves it out.
    writer.context.code.pin(value);
    eachKeyedField(writer.context, location.keyed, span, (_, position) =>
      writeAt(
        writer,
        deeper(location.within, [{ kind: 'field', field: position }, ...location.path]),
        value,
        span,
      ),
    );
    return;
  }
  const { code } = writer.context;
  const { place } = location;
  if (place.root.kind === 'register' && place.path.length === 0) {
    code.letGo([place.root.register], span);
    code.emit({ kind: 'move', span, dst: place.root.register, src: code.take(value, span) });
  } else {
    code.emit({ kind: 'store', span, place, value: code.take(value, span) });
  }
}
