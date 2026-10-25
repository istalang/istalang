/**
 * The one walk over a top-level constant's initializer (§3): it decides what compile time computes
 * and computes it, in the same switch, so the two can't disagree. Compile time computes literals, a
 * negated number among them, duration literals, tuples, structs in every literal form (a spread
 * copying a computed struct's fields), a struct without fields written bare, arrays and maps of
 * `Map`, and other top-level constants; anything else, a map literal of another type among them,
 * is refused where it stands.
 *
 * A spread spreads only an array or a map compile time built itself: its elements, or its entries
 * as tuples. Anything else iterable is iterated by `iterate` when the program runs, and computing
 * it here would be a second home for what the runtime's `iterate` does.
 */

import type {
  ArrayLiteral,
  Expression,
  MapLiteral,
  Spread,
  StructLiteral,
} from '../../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../../syntax/node.ts';
import type { CheckedBody, CheckedConstant } from '../check.ts';
import { type ConstantForm, durationForm, sameForm } from '../constant-form.ts';
import type { FieldMember, Type } from '../types/type.ts';

/** What the walk reads: the initializer's checking, struct layouts, and the other constants. */
export interface ComputationScope {
  readonly checked: CheckedBody;
  readonly fieldsOf: (type: Type) => readonly FieldMember[] | undefined;
  readonly constantNamed: (name: Identifier) => CheckedConstant | undefined;
}

/** How computing a part of an initializer went. */
export type Outcome =
  | { readonly kind: 'computed'; readonly form: ConstantForm }
  /** Compile time doesn't compute `part`. */
  | { readonly kind: 'refused'; readonly part: NodeOf<string> }
  /** An error a diagnostic already explained leaves no value. */
  | { readonly kind: 'unknown' };

const unknown: Outcome = { kind: 'unknown' };

/** What compile time makes of `initializer`. */
export function computeConstant(initializer: Expression, scope: ComputationScope): Outcome {
  return new Computation(scope).of(initializer);
}

class Computation {
  readonly #scope: ComputationScope;

  constructor(scope: ComputationScope) {
    this.#scope = scope;
  }

  of(node: Expression): Outcome {
    switch (node.kind) {
      case 'IntegerLiteral':
      case 'FloatLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return computed({ kind: 'primitive', value: node.value });
      case 'DurationLiteral': {
        const type = this.#scope.checked.typeOf(node);
        return type.kind === 'nominal' ? computed(durationForm(type, node.value)) : unknown;
      }
      case 'Parenthesized':
        return this.of(node.expression);
      case 'Unary':
        return node.operator === '-' && isNumberLiteral(node.operand)
          ? negated(this.of(node.operand))
          : refused(node);
      case 'Identifier': {
        const constant = this.#scope.constantNamed(node);
        if (constant === undefined) {
          return this.#bareStruct(node);
        }
        return constant.form === undefined ? unknown : computed(constant.form);
      }
      case 'StructLiteral':
        return this.#struct(node);
      case 'Tuple':
        return this.#tuple(node.elements);
      case 'ArrayLiteral':
        return this.#array(node);
      case 'MapLiteral':
        return this.#map(node);
      case 'Missing':
      case 'Invalid':
        return unknown;
      default:
        return refused(node);
    }
  }

  /** A struct in any literal form, its fields in declaration order. */
  #struct(node: StructLiteral): Outcome {
    const type = this.#scope.checked.typeOf(node);
    const fields = this.#scope.fieldsOf(type);
    if (fields === undefined || (type.kind !== 'nominal' && type.kind !== 'anonymous')) {
      return unknown;
    }
    if (node.items.some((item) => item.kind === 'Invalid')) {
      return unknown;
    }
    const sources = this.#scope.checked.sourcesOf(node);
    if (sources === undefined) {
      return unknown;
    }
    const forms: ConstantForm[] = [];
    for (const source of sources) {
      const part = source.kind === 'value' ? this.of(source.value) : this.#spreadField(source);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.push(part.form);
    }
    return computed({ kind: 'struct', type, fields: forms });
  }

  /** The field at `index` of a spread value, which must itself compute to a struct. */
  #spreadField(source: { readonly from: Expression; readonly index: number }): Outcome {
    const whole = this.of(source.from);
    if (whole.kind !== 'computed') {
      return whole;
    }
    const field = whole.form.kind === 'struct' ? whole.form.fields[source.index] : undefined;
    return field === undefined ? unknown : computed(field);
  }

  #tuple(elements: readonly Expression[]): Outcome {
    if (elements.length === 0) {
      return computed({ kind: 'primitive', value: null });
    }
    const forms: ConstantForm[] = [];
    for (const element of elements) {
      const part = this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.push(part.form);
    }
    return computed({ kind: 'tuple', elements: forms });
  }

  /** An array of its elements and spreads' items; `[]` where a `Map` is expected is an empty map. */
  #array(node: ArrayLiteral): Outcome {
    const form = this.#scope.checked.collectionFormOf(node);
    if (form !== 'array') {
      return form === 'map' ? computed({ kind: 'map', entries: [] }) : refused(node);
    }
    const elements: ConstantForm[] = [];
    for (const element of node.elements) {
      const part = element.kind === 'Spread' ? this.#items(element) : this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      elements.push(...(element.kind === 'Spread' ? itemsOf(part.form) : [part.form]));
    }
    return computed({ kind: 'array', elements });
  }

  /** A map of its entries in order, a later equal key replacing the value (§2). */
  #map(node: MapLiteral): Outcome {
    if (this.#scope.checked.collectionFormOf(node) !== 'map') {
      return refused(node);
    }
    const pairs: ConstantForm[] = [];
    for (const entry of node.entries) {
      const part = this.#entry(entry);
      if (part.kind !== 'computed') {
        return part;
      }
      pairs.push(...itemsOf(part.form));
    }
    return computed({ kind: 'map', entries: pairs.reduce(withPair, []) });
  }

  /** What one entry of a map literal adds: something whose items are `(key, value)` tuples. */
  #entry(entry: MapLiteral['entries'][number]): Outcome {
    if (entry.kind === 'Invalid') {
      return unknown;
    }
    if (entry.kind === 'Spread') {
      return this.#items(entry);
    }
    const pair = this.#tuple([entry.key, entry.value]);
    return pair.kind === 'computed' ? computed({ kind: 'array', elements: [pair.form] }) : pair;
  }

  /** What a spread spreads: a computed array or map, its items read with `itemsOf`. */
  #items(spread: Spread): Outcome {
    const spreading = this.of(spread.expression);
    if (spreading.kind !== 'computed') {
      return spreading;
    }
    return spreading.form.kind === 'array' || spreading.form.kind === 'map'
      ? spreading
      : refused(spread);
  }

  /** A struct without fields named bare (§3.1); any other name that isn't a constant is refused. */
  #bareStruct(node: Identifier): Outcome {
    const type = this.#scope.checked.typeOf(node);
    return type.kind === 'nominal' && this.#scope.fieldsOf(type)?.length === 0
      ? computed({ kind: 'struct', type, fields: [] })
      : refused(node);
  }
}

/** The items a spread of `form`, an array or a map, gives: its elements, or its entries as tuples. */
function itemsOf(form: ConstantForm): readonly ConstantForm[] {
  switch (form.kind) {
    case 'array':
      return form.elements;
    case 'map':
      return form.entries.map(([key, value]) => ({ kind: 'tuple', elements: [key, value] }));
    default:
      return [];
  }
}

/** `entries` with the `(key, value)` tuple `pair` set: an equal key's value is replaced (§2). */
function withPair(
  entries: readonly (readonly [ConstantForm, ConstantForm])[],
  pair: ConstantForm,
): (readonly [ConstantForm, ConstantForm])[] {
  const [key, value] = pair.kind === 'tuple' ? pair.elements : [];
  if (key === undefined || value === undefined) {
    return [...entries];
  }
  const position = entries.findIndex(([other]) => sameForm(other, key));
  return position < 0 ? [...entries, [key, value]] : entries.with(position, [key, value]);
}

function computed(form: ConstantForm): Outcome {
  return { kind: 'computed', form };
}

function refused(part: NodeOf<string>): Outcome {
  return { kind: 'refused', part };
}

/** A number literal, possibly parenthesized: what compile time negates. */
function isNumberLiteral(node: Expression): boolean {
  if (node.kind === 'Parenthesized') {
    return isNumberLiteral(node.expression);
  }
  return node.kind === 'IntegerLiteral' || node.kind === 'FloatLiteral';
}

function negated(operand: Outcome): Outcome {
  if (operand.kind !== 'computed') {
    return operand;
  }
  const { value } = operand.form.kind === 'primitive' ? operand.form : { value: undefined };
  return typeof value === 'bigint' || typeof value === 'number'
    ? computed({ kind: 'primitive', value: -value })
    : unknown;
}
