/**
 * Indented values (§2): what a block builds is decided by the type it is built as, then the block
 * is checked as the brace or bracket literal it reads as (syntax/expressions/indented-values.ts),
 * so every rule of literals keeps its one home (structs.ts, collections.ts).
 *
 * - `T:` naming a struct, a variant, or an alias of a struct or a shape builds a struct, `T{…}`;
 *   naming any other type, a map or an array of that type, as `[…]` built where `T` is expected.
 * - With no `T`, the expected type decides, as for `struct{…}` and `[…]`: a struct type builds a
 *   struct; a type a map literal builds, a map; an array type, an array. A union is built as the
 *   one member the value fits, which choosing found before (types/expected.ts). A value whose
 *   type nothing decides builds what its entries say: items an array, a quoted key a map, names
 *   alone a shape.
 * - Entries the literal can't hold are reported, each once, and their values checked alone, so
 *   tools still read them. A map built as an indented value has String keys, so a map whose key
 *   type no String literal fits is refused whole.
 *
 * The literal checked is recorded with the body (`builtLiteralOf`), for lowering and tools.
 */

import { type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import type { Entity } from '../../binder/entities.ts';
import { isDeclaredStruct } from '../../syntax/declarations.ts';
import {
  entriesLeftOut,
  isItem,
  isKeyed,
  type LiteralForm,
  literalOf,
  untypedForm,
} from '../../syntax/expressions/indented-values.ts';
import type { IndentedEntry, IndentedValue } from '../../syntax/expressions/index.ts';
import { lastName } from '../../syntax/node.ts';
import type { Accepts, BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { builtFrom, collectionTarget } from '../types/expected.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { literalType, membersOf } from '../types/unions.ts';
import { aliasedShape } from './literal-types.ts';

/** What a value is built as, and the type its literal is checked against. */
interface Building {
  readonly form: LiteralForm;
  readonly target: Type | undefined;
}

export function checkIndentedValue(
  context: BodyContext,
  node: IndentedValue,
  expected: Type | undefined,
): Type {
  const { form, target } = buildingOf(context, node, expected);
  const fits = reportLeftOut(context, node, form) && keysFit(context, node, form, target);
  if (!fits) {
    checkValuesAlone(context, node.entries);
    return errorType;
  }
  const literal = literalOf(node, form);
  context.recordBuilt(node, literal);
  return context.expression(literal, target);
}

/** What `node` builds where `expected` is expected, and the type its literal is checked against. */
function buildingOf(
  context: BodyContext,
  node: IndentedValue,
  expected: Type | undefined,
): Building {
  if (node.type === undefined) {
    return { form: anonymousForm(context, node, expected), target: expected };
  }
  const entity = context.entityOf(lastName(node.type.path));
  if (entity === undefined || namesStruct(context, entity)) {
    return { form: 'struct', target: expected };
  }
  const named = context.resolveType(node.type);
  return { form: formOf(context, named) ?? 'struct', target: named };
}

/** What `node`, naming no type, builds where `expected` is expected: what the type says, else its entries. */
function anonymousForm(
  context: BodyContext,
  node: IndentedValue,
  expected: Type | undefined,
): LiteralForm {
  return formOf(context, builtFrom(context.checker, expected)) ?? untypedForm(node);
}

/**
 * Whether a literal naming `entity` builds a struct: a variant, a struct other than an `Array` or
 * a `Map`, which collection literals build, or an alias of a shape.
 */
function namesStruct(context: BodyContext, entity: Entity): boolean {
  if (entity.kind === 'variant' || entity.kind === 'variants') {
    return true;
  }
  if (entity.kind !== 'type' || collections.some((each) => isWellKnown(context, entity, each))) {
    return false;
  }
  const { declaration } = entity;
  return aliasedShape(context, declaration) !== undefined || isDeclaredStruct(declaration);
}

const collections = [wellKnown.array, wellKnown.map];

function isWellKnown(context: BodyContext, entity: Entity, known: WellKnownDeclaration): boolean {
  const type = context.checker.wellKnownType(known);
  return type?.kind === 'nominal' && type.entity === entity;
}

/**
 * What a value built as `type` is built as (§2): an array or a map of the types collection
 * literals build, a struct of a struct type, else a map of a type built through its `default()`;
 * undefined when `type` decides none.
 */
function formOf(context: BodyContext, type: Type | undefined): LiteralForm | undefined {
  const collection = collectionTarget(context.checker, type);
  if (collection?.kind === 'array' || collection?.kind === 'map') {
    return collection.kind;
  }
  if (type !== undefined && isStructType(context, type)) {
    return 'struct';
  }
  return collection === undefined ? undefined : 'map';
}

/** Whether a literal builds a value of `type` as a struct: a shape, or a struct with fields. */
function isStructType(context: BodyContext, type: Type): boolean {
  return (
    type.kind === 'anonymous' ||
    (type.kind === 'nominal' && context.checker.fieldsOf(type) !== undefined)
  );
}

/**
 * Reports the entries `form`'s literal can't hold, each once: items and keys mixed, once for the
 * value; whether none was.
 */
function reportLeftOut(context: BodyContext, node: IndentedValue, form: LiteralForm): boolean {
  const { entries } = node;
  const firstItem = entries.find(isItem);
  if (firstItem !== undefined && entries.some(isKeyed)) {
    context.report(checkerDiagnostics.itemsAndKeys(firstItem.span));
    return false;
  }
  const leftOut = entriesLeftOut(node, form);
  for (const entry of leftOut) {
    context.report(leftOutDiagnostic(entry, form));
  }
  return leftOut.length === 0;
}

function leftOutDiagnostic(entry: IndentedEntry, form: LiteralForm) {
  const { span } = entry;
  if (entry.kind === 'IndentedItem') {
    return checkerDiagnostics.itemsInKeyedValue(span, form === 'map' ? 'map' : 'struct');
  }
  if (form === 'array') {
    return checkerDiagnostics.keysInArray(span);
  }
  return entry.kind === 'QuotedEntry'
    ? checkerDiagnostics.quotedKeyInStruct(span)
    : checkerDiagnostics.comprehensionInMap(span);
}

/**
 * Whether a map built of `node` takes its String keys: a map whose key type no String literal fits
 * is reported, once for the value (§2).
 */
function keysFit(
  context: BodyContext,
  node: IndentedValue,
  form: LiteralForm,
  target: Type | undefined,
): boolean {
  if (form !== 'map') {
    return true;
  }
  const collection = collectionTarget(context.checker, target);
  const key = collection?.kind === 'map' ? collection.arguments[0] : undefined;
  if (key === undefined || takesStrings(context, key)) {
    return true;
  }
  const at = node.type?.span ?? node.span;
  context.report(
    checkerDiagnostics.keysNotStrings(at, typeText(builtFrom(context.checker, target) ?? key)),
  );
  return false;
}

/** Whether some String literal fits `key`: one of its String literal types, or any String. */
function takesStrings(context: BodyContext, key: Type): boolean {
  return membersOf(key).some(
    (member) =>
      (member.kind === 'literal' && typeof member.value === 'string') ||
      context.checker.fitOf(literalType(''), member) !== undefined,
  );
}

/** Checks every value `entries` hold, for a value whose literal can't be checked. */
function checkValuesAlone(context: BodyContext, entries: readonly IndentedEntry[]): void {
  for (const entry of entries) {
    switch (entry.kind) {
      case 'FieldInitializer':
        context.expression(entry.value ?? entry.name);
        break;
      case 'QuotedEntry':
        context.expression(entry.value);
        break;
      case 'Spread':
        context.expression(entry.expression);
        break;
      case 'IndentedItem':
        context.expression(entry.value.kind === 'Spread' ? entry.value.expression : entry.value);
        break;
      default:
        break;
    }
  }
}

/**
 * Which types `node` can be built as where a call or a union decides (types/expected.ts): for each,
 * whether the literal of the form that type asks for takes it, its entries all held there. A value
 * naming its type is taken as its literal is, a variant's by its enums.
 */
export function indentedAccepts(context: BodyContext, node: IndentedValue): Accepts | undefined {
  if (node.type !== undefined) {
    return context.accepts(literalOf(node, 'struct'));
  }
  return (expected, isOpen) => {
    const form = anonymousForm(context, node, expected);
    if (entriesLeftOut(node, form).length > 0) {
      return false;
    }
    const part = context.acceptedPart(literalOf(node, form));
    if (part.kind === 'decided') {
      return part.accepts(expected, isOpen);
    }
    if (part.builds !== undefined) {
      return part.builds(expected, isOpen);
    }
    return part.type === undefined || context.checker.fitOf(part.type, expected) !== undefined;
  };
}
