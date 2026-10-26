/**
 * JSON forms (§9; docs/arch/boundary.md): how each type crosses as JSON, decided once per type.
 * Lowering writes each type's codecs from its form; the derived markers `Encodable` and
 * `Decodable` (§3.10) hold for a type whose form can be written, or read, all the way down.
 *
 * - A struct or enum that is `Stringable` is its `toString`, read back through `parse` when it is
 *   also `Parsable`; otherwise a struct is an object of its fields, an enum the same with a
 *   `"type"` tag, a tuple an array. Arrays, optionals and maps are containers, whose codecs are
 *   json-module helpers taking the codec of what they hold; every other leaf is a helper call.
 * - Every helper call is resolved here, with its witnesses, as a call written in the type's own
 *   module would be: a struct's `toString` and `parse` are the ones its module sees, so a form
 *   belongs to the type alone (§9).
 * - A type with no form says why, in words a diagnostic finishes: a function, a handle, a nested
 *   optional, a map whose keys aren't Stringable. A form that can be written but not read (a
 *   Stringable type that isn't Parsable) says why it can't be read.
 * - `never` has no value, so there is never one to write, and none to read.
 * - A recursive type has a form like any other: deciding whether it can be written or read counts
 *   the type being decided as fine while its own parts are, as Sendable does.
 */

import {
  type CodecHelper,
  type CodecName,
  codecFunctions,
  codecHelpers,
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../language/well-known.ts';
import { memo } from '../../../../structures/memo.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import { isStdModule, type ModuleId } from '../../../program/program.ts';
import type { FunctionCall } from '../../check.ts';
import type { CheckerContext } from '../../context.ts';
import { callWithTypes } from '../../overloads/typed-call.ts';
import { isWellKnownTrait } from '../../traits/sendable.ts';
import type { FieldMember, NominalType, Type } from '../../types/type.ts';
import { typeText } from '../../types/type-text.ts';
import { wellKnownArguments } from '../../types/well-known.ts';
import type { Annotations } from '../annotations.ts';
import {
  type Codec,
  type JsonDirection,
  type JsonField,
  type JsonForm,
  type JsonFormQueries,
  jsonMarkers,
} from './form.ts';

/** What the unit needs beside the checker: field annotations. */
export interface JsonFormSeams {
  readonly checker: CheckerContext;
  readonly annotations: Annotations;
}

const leafHelpers = {
  int: [codecHelpers.encodeInt, codecHelpers.decodeInt],
  float: [codecHelpers.encodeFloat, codecHelpers.decodeFloat],
  bool: [codecHelpers.encodeBool, codecHelpers.decodeBool],
  string: [codecHelpers.encodeString, codecHelpers.decodeString],
  unit: [codecHelpers.encodeUnit, codecHelpers.decodeUnit],
} as const;

const containers = [
  [wellKnown.array, codecHelpers.encodeArray, codecHelpers.decodeArray],
  [wellKnown.optional, codecHelpers.encodeOptional, codecHelpers.decodeOptional],
  [wellKnown.map, codecHelpers.encodeMap, codecHelpers.decodeMap],
] as const satisfies readonly (readonly [WellKnownDeclaration, CodecHelper, CodecHelper])[];

export class JsonForms implements JsonFormQueries {
  readonly #seams: JsonFormSeams;
  readonly #forms = new Map<string, JsonForm>();

  constructor(seams: JsonFormSeams) {
    this.#seams = seams;
  }

  /**
   * How `type` crosses as JSON; a type parameter or an error type has none of its own, and
   * nothing has one in a program without the json module, which every codec is made of.
   */
  formOf(type: Type): JsonForm {
    if (this.#seams.checker.program.roles.json === undefined) {
      return { kind: 'none', reason: 'the program has no json module' };
    }
    return memo(this.#forms, this.#seams.checker.typeKeys.typeKey(type), () => this.#form(type));
  }

  /** Why `type` can't cross in `direction`, finishing "it has no JSON form: …"; undefined if it can. */
  problemOf(type: Type, direction: JsonDirection): string | undefined {
    return this.#problem(type, direction, new Set());
  }

  #problem(type: Type, direction: JsonDirection, deciding: Set<string>): string | undefined {
    if (type.kind === 'error') {
      return undefined;
    }
    if (type.kind === 'primitive' && type.name === 'never' && direction === 'write') {
      return undefined;
    }
    if (type.kind === 'parameter') {
      return this.#constrained(type, direction)
        ? undefined
        : `'${typeText(type)}' isn't constrained 'is ${direction === 'write' ? 'Encodable' : 'Decodable'}'`;
    }
    const key = this.#seams.checker.typeKeys.typeKey(type);
    if (deciding.has(key)) {
      return undefined;
    }
    deciding.add(key);
    const problem = this.#formProblem(this.formOf(type), direction, deciding);
    deciding.delete(key);
    return problem;
  }

  #formProblem(
    form: JsonForm,
    direction: JsonDirection,
    deciding: Set<string>,
  ): string | undefined {
    const inside = (type: Type) => this.#problem(type, direction, deciding);
    switch (form.kind) {
      case 'json':
        return undefined;
      case 'none':
        return form.reason;
      case 'leaf':
        return direction === 'read' ? form.unreadable : undefined;
      case 'container':
        return (direction === 'read' ? form.unreadable : undefined) ?? inside(form.element);
      case 'tuple':
        return firstOf(form.elements, inside);
      case 'record':
        return fieldsProblem(form.fields, inside);
      case 'enum':
        return firstOf(form.variants, (variant) => fieldsProblem(variant.fields, inside));
      default: {
        const unhandled: never = form;
        return unhandled;
      }
    }
  }

  #constrained(type: Extract<Type, { kind: 'parameter' }>, direction: JsonDirection): boolean {
    const { checker } = this.#seams;
    return (
      type.declaration.kind === 'TypeParameter' &&
      checker
        .constraintsOf(type.declaration)
        .some(({ trait }) => isWellKnownTrait(checker, trait, jsonMarkers[direction]))
    );
  }

  #form(type: Type): JsonForm {
    switch (type.kind) {
      case 'primitive':
        return type.name in leafHelpers
          ? this.#leaf(leafHelpers[type.name as keyof typeof leafHelpers], [])
          : { kind: 'none', reason: `'${type.name}' has no value` };
      case 'function':
        return { kind: 'none', reason: 'a function never leaves for the host' };
      case 'tuple':
        return { kind: 'tuple', elements: type.elements };
      case 'anonymous':
        return this.#record(type.fields);
      case 'nominal':
        return this.#nominal(type);
      case 'parameter':
      case 'error':
        return { kind: 'none', reason: `'${typeText(type)}' isn't a concrete type` };
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  #nominal(type: NominalType): JsonForm {
    const { checker } = this.#seams;
    const { declaration } = type.entity;
    const module = checker.bindings.moduleOf(type.entity) ?? this.#jsonModule();
    if (checker.wellKnownEntity(wellKnown.json) === type.entity) {
      return { kind: 'json' };
    }
    for (const [container, encode, decode] of containers) {
      if (checker.wellKnownEntity(container) === type.entity) {
        return this.#container(type, encode, decode, module);
      }
    }
    if (declaration.kind === 'ExternStructDeclaration') {
      return this.#external(type, declaration.isSendable, module);
    }
    const stringable = this.#stringable(type, module);
    if (stringable !== undefined) {
      return stringable;
    }
    if (declaration.kind === 'StructDeclaration') {
      return this.#record(checker.fieldsOf(type) ?? []);
    }
    return this.#enum(type);
  }

  /**
   * An extern type: a host type is its host's JSON, a plain value when it is declared sendable, or
   * kept in a resource when a `dispose` makes it disposable (§7); anything else has no form.
   */
  #external(type: NominalType, isSendable: boolean, module: ModuleId): JsonForm {
    const { checker } = this.#seams;
    const isHost = !isStdModule(checker.program, module);
    if (isHost && (isSendable || checker.disposalOf(type).kind === 'function')) {
      return this.#leaf([codecHelpers.encodeHandle, codecHelpers.decodeHandle], [type]);
    }
    return {
      kind: 'none',
      reason: isHost
        ? `'${typeText(type)}' is neither declared sendable nor disposable`
        : `'${typeText(type)}' is a handle, which stays in its instance`,
    };
  }

  /** A struct or enum that is Stringable, as its `toString`; undefined for one that isn't. */
  #stringable(type: NominalType, module: ModuleId): JsonForm | undefined {
    const written = this.#call(codecHelpers.encodeText, [type], module);
    if (written === undefined) {
      return undefined;
    }
    const read = this.#call(codecHelpers.decodeParsed, [type], module);
    return {
      kind: 'leaf',
      codec: { encode: written, decode: read },
      unreadable:
        read === undefined
          ? `'${typeText(type)}' is Stringable but not Parsable, so it can't be read`
          : undefined,
    };
  }

  #container(
    type: NominalType,
    encodeName: CodecHelper,
    decodeName: CodecHelper,
    module: ModuleId,
  ): JsonForm {
    const { checker } = this.#seams;
    const element = type.arguments.at(-1);
    const [first] = type.arguments;
    if (element === undefined || first === undefined) {
      return { kind: 'none', reason: `'${typeText(type)}' has no type arguments` };
    }
    if (
      encodeName === codecHelpers.encodeOptional &&
      element.kind === 'nominal' &&
      element.entity === checker.optionalEntity
    ) {
      return {
        kind: 'none',
        reason: `'${typeText(type)}' nests an optional, whose two nones JSON can't tell apart`,
      };
    }
    const encode = this.#call(encodeName, type.arguments, module);
    if (encode === undefined) {
      return { kind: 'none', reason: `its keys, '${typeText(first)}', aren't Stringable` };
    }
    const decode = this.#call(decodeName, type.arguments, module);
    return {
      kind: 'container',
      element,
      codec: { encode, decode },
      unreadable:
        decode === undefined ? `its keys, '${typeText(first)}', aren't Parsable` : undefined,
    };
  }

  #record(fields: readonly FieldMember[]): JsonForm {
    return { kind: 'record', fields: fields.map((field) => this.#field(field)) };
  }

  #enum(type: NominalType): JsonForm {
    const variants = (this.#seams.checker.variantsOf(type) ?? []).map((variant) => ({
      name: variant.name,
      fields: variant.fields.map((field) => this.#field(field)),
    }));
    const colliding = variants.find((variant) =>
      variant.fields.some((field) => field.key === 'type'),
    );
    return colliding === undefined
      ? { kind: 'enum', variants }
      : {
          kind: 'none',
          reason: `its variant '${colliding.name}' has a field whose JSON name is 'type', which names the variant`,
        };
  }

  #field(field: FieldMember): JsonField {
    const { annotations } = this.#seams;
    return {
      name: field.name,
      key: annotations.jsonNameOf(field),
      type: field.type,
      skipped: annotations.skippedValueOf(field),
      optional:
        wellKnownArguments(this.#seams.checker, wellKnown.optional, field.type) !== undefined,
      codec: annotations.fieldHas(field, 'jsonBigInt')
        ? this.#codec([codecHelpers.encodeBigInt, codecHelpers.decodeBigInt], [])
        : undefined,
    };
  }

  #leaf(names: readonly [CodecHelper, CodecHelper], typeArguments: readonly Type[]): JsonForm {
    return { kind: 'leaf', codec: this.#codec(names, typeArguments), unreadable: undefined };
  }

  /** A codec of two helpers that always apply. */
  #codec(
    [encode, decode]: readonly [CodecHelper, CodecHelper],
    typeArguments: readonly Type[],
  ): Codec {
    return {
      encode: this.callOf(encode, typeArguments),
      decode: this.callOf(decode, typeArguments),
    };
  }

  /**
   * The call to the json module's helper `name` with `typeArguments`, as made in `module`, where
   * its constraints' witnesses are found; undefined when they aren't met.
   */
  #call(
    name: CodecName,
    typeArguments: readonly Type[],
    module: ModuleId,
  ): FunctionCall | undefined {
    const { checker } = this.#seams;
    const candidates = checker
      .languageFunctions('json', name)
      .map((declaration) => ({ declaration }));
    return callWithTypes(checker, candidates, typeArguments, module);
  }

  callOf(name: CodecHelper, typeArguments: readonly Type[]): FunctionCall {
    return this.#jsonCall(name, typeArguments);
  }

  encoderOf(type: Type): FunctionCall {
    return this.#jsonCall(codecFunctions.encode, [type]);
  }

  decoderOf(type: Type): FunctionCall {
    return this.#jsonCall(codecFunctions.decodeAt, [type]);
  }

  /**
   * The call to the json module's function `name` with `typeArguments`, made in the json module;
   * a codec or a helper always applies, so failing is a bug in the toolchain.
   */
  #jsonCall(name: CodecName, typeArguments: readonly Type[]): FunctionCall {
    const call = this.#call(name, typeArguments, this.#jsonModule());
    if (call === undefined) {
      unreachable(
        `The json module's '${name}' doesn't take ${typeArguments.map(typeText).join(', ')}.`,
      );
    }
    return call;
  }

  /** The json module, which `formOf` makes sure the program has. */
  #jsonModule(): ModuleId {
    const { json } = this.#seams.checker.program.roles;
    if (json === undefined) {
      unreachable('A JSON form was decided in a program without the json module.');
    }
    return json;
  }
}

/** The first problem `problemOf` finds among `items`. */
function firstOf<Item>(
  items: readonly Item[],
  problemOf: (item: Item) => string | undefined,
): string | undefined {
  for (const item of items) {
    const problem = problemOf(item);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/** The first problem among the fields that cross, naming the field. */
function fieldsProblem(
  fields: readonly JsonField[],
  inside: (type: Type) => string | undefined,
): string | undefined {
  return firstOf(fields, (field) => {
    if (field.skipped !== undefined || field.codec !== undefined) {
      return;
    }
    const problem = inside(field.type);
    return problem === undefined ? undefined : `its field '${field.name}': ${problem}`;
  });
}
