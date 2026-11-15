/**
 * How a type reads in messages (and M7's hovers): the way a programmer would write it,
 * `Pair<Int, String>`, `Int?`, `fn(Int) -> Bool`, `"draft" | "sent"`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where. A type written through an alias reads as the alias, with its arguments
 * (§3.17), as the programmer wrote it; any other shape reads as its fields, never as a key. A
 * recursive type reads as the alias it was written through, else as its node's label. A function
 * type reads as its head would write it, `sendable live fn(Int) -> Bool`, or as `Fn<(T,), U, M>`
 * where its mark or sendability is a variable no head's word spells. Types one message spells
 * together tell apart distinct type parameters of one name (`typeTextsTogether`).
 */

import { selfType } from '../../../../foundation/language/well-known/index.ts';
import type { TypeAliasDeclaration, TypeParameter } from '../../../syntax/declarations/index.ts';
import type { RestPattern } from '../../../syntax/patterns.ts';
import { modifiersText } from '../../../syntax/tokens/modifiers.ts';
import { folded } from '../identity/folding.ts';
import { holdsRecursion } from '../parts/type-children.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { AliasUse } from './alias-uses.ts';
import { type MappedParts, type RecursiveType, unfoldRecursive } from './computed-types.ts';
import { modifiersOf } from './function-types.ts';
import {
  type AnonymousStructType,
  type Constraint,
  type FunctionType,
  type NominalType,
  nominalType,
  type ParameterKey,
  type ParameterSlot,
  type Type,
  type TypeParameterType,
  type UnionType,
} from './index.ts';
import { sameMark } from './mark-orders.ts';
import { isPrimitive, literalText } from './primitives.ts';

/** The unlabelled recursive types being printed as their bodies, each `…` where reached again. */
const printing = new Set<RecursiveType>();

/** The names of the parameters reading alike in the types spelled together (`typeTextsTogether`). */
let primed: ReadonlyMap<ParameterKey, string> = new Map();

/**
 * `types` spelled for one message, each as `typeText` spells it, but for distinct type parameters
 * among them of one name (a declaration's, as written): each after the first to appear is primed (`T'`, `T''`), as no name is
 * written so, and the message tells them apart, a call's parameter from its caller's of the name.
 */
export function typeTextsTogether(types: readonly Type[]): readonly string[] {
  const declared = new Set(types.flatMap(parametersIn).filter(isTypeParameter));
  const byName = Map.groupBy(declared, (parameter) => parameter.name.text);
  primed = new Map(
    [...byName].flatMap(([name, parameters]) =>
      parameters.slice(1).map((parameter, index) => [parameter, `${name}${"'".repeat(index + 1)}`]),
    ),
  );
  try {
    return types.map(typeText);
  } finally {
    primed = new Map();
  }
}

/** A recursive type no alias wrote, read as its body, itself `…` inside it. */
function unlabelledText(type: RecursiveType): string {
  const node = type.graph.types[type.node] ?? type;
  if (printing.has(node)) {
    return '…';
  }
  printing.add(node);
  try {
    return typeText(unfoldRecursive(node));
  } finally {
    printing.delete(node);
  }
}

/** `of.name`, an associated type as written (§3.1). */
function associatedText(of: Type, name: string): string {
  return `${ownerText(of)}.${name}`;
}

/** A type as it reads before `.` or `[`: parenthesized where it wouldn't bind tightest (§3.1). */
function ownerText(type: Type): string {
  const text = typeText(type);
  const bindsLoosely =
    type.alias === undefined &&
    (type.kind === 'union' || type.kind === 'function' || type.kind === 'any');
  return bindsLoosely ? `(${text})` : text;
}

/**
 * `type` as written and, when it was written through an alias, an associated type or a struct's
 * keys, what that names, `keyof Settings = "region" | "retries"`: what a tool shows of a type, so a
 * spelling never hides what it stands for (§3.17). A spelling naming only itself, an unreduced one,
 * shows once.
 */
export function writtenAndNamedText(type: Type): string {
  const written = typeText(type);
  if (type.alias === undefined) {
    return written;
  }
  const named = typeText({ ...type, alias: undefined });
  return named === written ? written : `${written} = ${named}`;
}

/**
 * `type` as source would spell it. Extern keys spell types too (definition/extern-key.ts), but
 * apart on purpose: they are a persisted identity, and must never follow a change of wording here.
 */
export function typeText(given: Type): string {
  // A type equal to a recursive alias, as what one unfolds to is, reads as that alias.
  const type = given.alias === undefined && holdsRecursion(given) ? folded(given) : given;
  const { alias } = type;
  if (alias !== undefined) {
    return spellingText(alias);
  }
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return nominalTypeText(type);
    case 'anonymous':
      return anonymousText(type);
    case 'recursive': {
      const label = type.graph.labels[type.node];
      return label === undefined ? unlabelledText(type) : spellingText(label);
    }
    case 'tuple':
      return `(${type.elements.map(typeText).join(', ')}${type.elements.length === 1 ? ',' : ''})`;
    case 'function': {
      const { head, parameters, tail } = functionTypeParts(type);
      return `${head}${parameters.join(', ')}${tail}`;
    }
    case 'parameter':
      return parameterText(type);
    case 'any':
      return `any ${type.constraints.map(constraintText).join(' & ')}`;
    case 'literal':
      return literalText(type.value);
    case 'union':
      return unionText(type);
    case 'associated':
      return associatedText(type.of, type.name);
    case 'field':
      return `${ownerText(type.of)}[${typeText(type.key)}]`;
    case 'keys':
      return keysText(type.of, type.without);
    case 'mapped':
      return mappedText(type);
    case 'match':
      return type.owner === undefined
        ? parameterizedText(type.declaration.name.text, type.arguments)
        : associatedText(nominalType(type.owner, type.arguments), type.declaration.name.text);
    case 'error':
      return '?';
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * A function type's text in parts, joined `head + parameters.join(', ') + tail`, so signature help
 * can mark each parameter: as its head would write it, `sendable live fn(Int) -> Bool`, or as `Fn`
 * where a slot is a variable (`fnParts`).
 */
export function functionTypeParts(type: FunctionType): {
  readonly head: string;
  readonly parameters: readonly string[];
  readonly tail: string;
} {
  if (spelledAsFn(type)) {
    return fnParts(type);
  }
  const parameters = type.parameters.map(slotText);
  if (type.pack !== undefined) {
    parameters.push(`...${typeText(type.pack)}`);
  }
  // A function giving a future of its own kind is written as its header is (§3.14).
  const awaited = ownFutureValue(type);
  return {
    head: `${modifiersText(modifiersOf(type))}${awaited === undefined ? '' : 'async '}fn(`,
    parameters,
    tail: `) -> ${typeText(awaited ?? type.result)}`,
  };
}

/**
 * Whether `type` is written as `Fn<…>` (§3.14): its sendability or mark is a variable no head's
 * word spells.
 */
function spelledAsFn({ mark, send }: FunctionType): boolean {
  return mark.kind !== 'literal' || send.kind !== 'literal';
}

/**
 * `Fn<(A, B), R, Kind, Send>` in parts: the tuple of its parameters, `(A,)` for one, a pack bare,
 * then its result and the slots its defaults don't already give, `"simple"` and `"plain"`.
 */
function fnParts(type: FunctionType): ReturnType<typeof functionTypeParts> {
  const slots = [type.mark, type.send];
  while (slots.length > 0 && isDefaultSlot(slots.at(-1), slots.length === 1 ? 'simple' : 'plain')) {
    slots.pop();
  }
  const rest = [type.result, ...slots].map(typeText).join(', ');
  if (type.pack !== undefined && type.parameters.length === 0) {
    return { head: 'Fn<', parameters: [typeText(type.pack)], tail: `, ${rest}>` };
  }
  const parameters = type.parameters.map(slotText);
  if (type.pack !== undefined) {
    parameters.push(`...${typeText(type.pack)}`);
  }
  const single = parameters.length === 1 && type.pack === undefined ? ',' : '';
  return { head: 'Fn<(', parameters, tail: `${single}), ${rest}>` };
}

function isDefaultSlot(slot: Type | undefined, value: string): boolean {
  return slot?.kind === 'literal' && slot.value === value;
}

/**
 * The value of the future `type`'s call gives where that future is of the function's own kind:
 * the prelude's `Future`, whose name no module may reuse (§3.13); undefined for any other result.
 */
function ownFutureValue(type: FunctionType): Type | undefined {
  const { result, mark } = type;
  if (
    result.kind !== 'nominal' ||
    result.entity.declaration.kind !== 'ExternStructDeclaration' ||
    result.entity.declaration.name.text !== futureName
  ) {
    return undefined;
  }
  const [value, kind] = result.arguments;
  return kind !== undefined && sameMark(kind, mark) ? value : undefined;
}

const futureName = 'Future';

/** A parameter's type as written: `&T` for one passed by reference (§3.7). */
export function slotText({ type, reference }: ParameterSlot): string {
  return `${reference ? '&' : ''}${typeText(type)}`;
}

/**
 * A constraint as written, of an `any` type or a type known by its bounds: its trait's own `Self`,
 * standing for each value's own type, is the default it came from, so trailing ones are left out
 * (`Iterable<Int>`).
 */
export function constraintText({ trait, arguments: typeArguments }: Constraint): string {
  const isOwnSelf = (type: Type | undefined) =>
    type?.kind === 'parameter' && type.declaration === trait;
  let written = typeArguments.length;
  while (written > 0 && isOwnSelf(typeArguments[written - 1])) {
    written -= 1;
  }
  return parameterizedText(trait.name.text, typeArguments.slice(0, written));
}

function nominalTypeText(type: NominalType): string {
  return parameterizedText(type.entity.declaration.name.text, type.arguments);
}

/**
 * A union as written, its members in the order first written (§2): `T?` for `T | None`, and a
 * function type member in parentheses, since its result would take what follows it.
 */
function unionText(type: UnionType): string {
  const member = (each: Type) =>
    each.kind === 'function' && each.alias === undefined ? `(${typeText(each)})` : typeText(each);
  const others = type.members.filter((each) => !isPrimitive(each, 'None'));
  const [only] = others;
  return others.length === 1 && only !== undefined
    ? `${member(only)}?`
    : type.members.map(member).join(' | ');
}

/** A shape as written, its fields in the name order it keeps them in (§3.1). */
/**
 * The keys of a struct type not known yet that its constraints don't name: `keyof S`, the names
 * also left out following it, as a mapped entry's or a rest's (§3.1).
 */
function keysText(of: Type, without: readonly string[]): string {
  const keys = `keyof ${ownerText(of)}`;
  return without.length === 0
    ? keys
    : `${keys} except ${without.map((name) => JSON.stringify(name)).join(' | ')}`;
}

/** A mapped struct type as written: `{ id: String, [F in keyof S]: S[F]? }` (§3.1). */
function mappedText(type: MappedParts): string {
  const named = type.named.map((field) => `${field.name}: ${typeText(field.type)}`);
  const mapped = `[${boundName(type.parameter)} in ${typeText(type.keys)}]: ${typeText(type.value)}`;
  return `{ ${[...named, mapped].join(', ')} }`;
}

function anonymousText(type: AnonymousStructType): string {
  return `struct { ${type.fields.map((field) => `${field.name}: ${typeText(field.type)}`).join(', ')} }`;
}

function parameterizedText(name: string, typeArguments: readonly Type[]): string {
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}

/**
 * A type parameter's name: its own, `Self` for a trait's; a field loop's key for the fields a
 * struct constraint leaves unnamed reads as the keys it ranges over (§4); a placeholder, which
 * settling replaces before any type is shown, as `_`.
 */
export function parameterText(type: TypeParameterType): string {
  const { declaration } = type;
  switch (declaration.kind) {
    case 'TraitDeclaration':
      return selfType;
    case 'FieldHeader':
      return type.within === undefined ? 'keyof …' : typeText(type.within);
    case 'Placeholder':
      return '_';
    default:
      return primed.get(declaration) ?? boundName(declaration);
  }
}

function isTypeParameter(parameter: ParameterKey): parameter is TypeParameter {
  return parameter.kind === 'TypeParameter';
}

/**
 * The name a parameter a declaration or a mapped type binds is written with; a struct pattern's
 * rest binds one for its keys unwritten, read as a mapped entry's conventional `F` (§3.11); a
 * recursive alias's placeholder reads as the alias.
 */
function boundName(declaration: TypeParameter | RestPattern | TypeAliasDeclaration): string {
  return declaration.kind === 'RestPattern' ? 'F' : declaration.name.text;
}

/** A spelling as source writes it: an alias with its arguments, an associated type, or keys. */
export function spellingText(alias: AliasUse): string {
  switch (alias.kind) {
    case 'alias':
      return parameterizedText(alias.declaration.name.text, alias.arguments);
    case 'associated':
      return associatedText(alias.of, alias.name);
    case 'keys':
      return `keyof ${ownerText(alias.of)}`;
    default: {
      const unhandled: never = alias;
      return unhandled;
    }
  }
}
