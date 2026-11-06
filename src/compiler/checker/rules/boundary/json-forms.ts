/**
 * Codecs (§3.10, §9; docs/arch/boundary.md): a type crosses as JSON through its `toJson` and
 * `fromJson`, what `Encodable` and `Decodable` require, found as any witness is (conformance.ts).
 * A struct, an enum, a tuple or a host type declaring neither has both derived by the compiler from
 * its form, decided here once per type, which lowering writes the derived codecs from.
 *
 * - A struct is an object of its fields, an enum the same with a tag naming the variant
 *   (`variantTagKey`), a tuple an array, a host type whatever JSON its host gave it, and a literal
 *   type or a union of literals its literal, as its base writes it, read back by each base's codec
 *   in turn: a literal's JSON says which it is.
 * - A union crosses only as `T | None`, through the json module's codecs of `T?`, or as literals:
 *   which member a value of any other union is would need a tag of its own, and how codecs read an
 *   untagged member is left open until codecs move into the language (§14).
 * - What a struct, an enum or a tuple holds crosses through its own codecs, which are coherent
 *   witnesses (§3.10), so a derived codec is the same wherever its type is used.
 * - A codec declared for a type is a witness found as any is: beside the type, or in the json
 *   module, which declares them for primitives, `Json` and the prelude's containers. Declaring
 *   either leaves nothing derived, so no type is written one way and read another.
 * - A derived codec exists when everything it holds meets the trait. A
 *   recursive type counts as meeting it while its own parts are decided, as Sendable does.
 * - What has no codec says why, in words a diagnostic finishes ("it needs …"): an enum with a field
 *   named as the tag; a function; a handle. A type with nothing more to say lacks the codec itself, as conformance says.
 * - What the json module's field annotations mean is decided here: a field's key after its
 *   `@JsonName`, an `@JsonBigInt` field's own codecs, and what an `@JsonSkip` field reads back as,
 *   which annotations.ts also asks to tell where the annotation may stand.
 */

import {
  type CodecHelper,
  type CodecName,
  codecHelpers,
  derivedCodecs,
} from '../../../../language/well-known.ts';
import type { EntryTable } from '../../../../structures/entries/index.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import type { CheckerContext, CheckerNote } from '../../context.ts';
import { witnessesFor } from '../../resolution/conformance.ts';
import { declaresWitness } from '../../resolution/declared-witness.ts';
import { defaultWitness } from '../../resolution/default-witness.ts';
import { callWithTypes } from '../../resolution/silent-choice.ts';
import { isHostType } from '../../surface/host-externs.ts';
import {
  type DerivedCodec,
  type DerivedForm,
  type JsonCodecs,
  type JsonDirection,
  type JsonField,
  jsonTraits,
  variantTagKey,
} from '../../surface/json-form.ts';
import type { FunctionCall, ResolvedCall } from '../../surface/resolved-call.ts';
import { wellKnownConstraint } from '../../traits/constraints.ts';
import { unfolded } from '../../types/computed-types.ts';
import { sameType } from '../../types/identity/identity.ts';
import type {
  FieldMember,
  LiteralType,
  NominalType,
  StructValueType,
  Type,
  UnionType,
} from '../../types/type.ts';
import { TypeCycle } from '../../types/type-cycle.ts';
import { unaliased } from '../../types/type-parts.ts';
import { typeText } from '../../types/type-text.ts';
import { baseOf } from '../../types/union-members.ts';
import { optionalInner } from '../../types/unions.ts';
import { hostSite, searchSite, silent, type UseSite } from '../../use-site.ts';
import type { Annotations } from '../annotations.ts';

/**
 * Why a handle has no codec, a std one such as a slot or a shared struct alike: its values have an
 * identity of their own (§3.1, §3.18).
 */
const handleHasNoForm = 'a JSON form, which no handle has: it stays in its instance';

/** Why a union other than an optional or a union of literals has no codec (§9). */
const unionHasNoForm = 'a JSON form, which a union has only as an optional or as literals';

/** What the unit needs beside the checker: field annotations. */
export interface JsonFormSeams {
  readonly checker: CheckerContext;
  readonly annotations: Annotations;
}

/** What a derived codec writes and reads of a type: each part's type, named for a diagnostic. */
interface Part {
  readonly name: string;
  readonly type: Type;
}

/**
 * A type's form, or nothing to derive its codecs from, which no derived codec is written from:
 * `reason` finishes "it needs …" when there is more to say than the codec itself.
 */
type FormOrNone = DerivedForm | { readonly kind: 'none'; readonly reason: string | undefined };

export class JsonForms implements JsonCodecs {
  readonly #seams: JsonFormSeams;
  /** Each type's form, by the spelled key of the type through no alias (types/identity/type-keys.ts). */
  readonly #forms: EntryTable<CheckerNote, string, FormOrNone, Type>;
  /** The derived codecs being decided, by direction, which count as found meanwhile. */
  readonly #deciding: Readonly<Record<JsonDirection, TypeCycle>>;

  constructor(seams: JsonFormSeams) {
    this.#seams = seams;
    this.#forms = seams.checker.entries.table({
      name: 'json forms',
      compute: (_key, type) => this.#form(type),
    });
    const { typeKeys } = seams.checker;
    this.#deciding = { write: new TypeCycle(typeKeys), read: new TypeCycle(typeKeys) };
  }

  formOf(type: Type): DerivedForm {
    const form = this.#formOf(type);
    if (form.kind === 'none') {
      unreachable(`${typeText(type)} has no JSON form, so no derived codec to write.`);
    }
    return form;
  }

  /** `type`'s form, kept by the spelling it is computed from: `type`'s, through no alias. */
  #formOf(type: Type): FormOrNone {
    const unspelled = unaliased(type);
    return this.#forms.get(this.#seams.checker.typeKeys.spelledKey(unspelled), unspelled);
  }

  derivedOf(site: UseSite, type: Type, direction: JsonDirection): DerivedCodec {
    const form = this.#formOf(type);
    if (form.kind === 'none') {
      return { kind: 'lacking', missing: form.reason };
    }
    const missing = this.#deciding[direction].enter(type, undefined, () =>
      this.#partMissing(site, form, direction),
    );
    if (missing !== undefined) {
      return { kind: 'lacking', missing };
    }
    return { kind: 'derived', call: this.#jsonCall(derivedCodecs[direction], [type]) };
  }

  skippedDefaultOf(type: Type): ResolvedCall | undefined {
    return defaultWitness(searchSite(this.#seams.checker), type);
  }

  /** The first part of `form` that doesn't meet the trait of `direction`, said as it lacks. */
  #partMissing(site: UseSite, form: DerivedForm, direction: JsonDirection): string | undefined {
    if (form.kind === 'host') {
      return undefined;
    }
    const inner = silent(site);
    const constraint = wellKnownConstraint(this.#seams.checker, jsonTraits[direction]);
    const failing = partsOf(form).find(
      ({ type }) => witnessesFor(inner, type, constraint) === undefined,
    );
    return failing === undefined
      ? undefined
      : `its ${failing.name} to be ${constraint.trait.name.text}`;
  }

  codecOf(type: Type, direction: JsonDirection): ResolvedCall | undefined {
    const { checker } = this.#seams;
    if (checker.inputs.role('json') === undefined) {
      return undefined;
    }
    const constraint = wellKnownConstraint(checker, jsonTraits[direction]);
    return witnessesFor(hostSite(searchSite(checker)), type, constraint)?.[0];
  }

  callOf(name: CodecHelper, typeArguments: readonly Type[]): FunctionCall {
    return this.#jsonCall(name, typeArguments);
  }

  #form(type: Type): FormOrNone {
    switch (type.kind) {
      case 'tuple':
        return { kind: 'tuple', type };
      case 'anonymous':
        return this.#record(type, type.fields);
      case 'recursive':
        return this.#form(unfolded(type));
      case 'nominal':
        return this.#nominal(type);
      case 'function':
        return { kind: 'none', reason: 'a JSON form, which no function has' };
      case 'any':
        return { kind: 'none', reason: "a JSON form, which no 'any' type has" };
      case 'literal':
        return { kind: 'literals', type, groups: [{ base: baseOf(type), literals: [type] }] };
      case 'union':
        return literalsForm(type) ?? { kind: 'none', reason: unionHasNoForm };
      case 'primitive':
      case 'parameter':
      case 'associated':
      case 'field':
      case 'keys':
      case 'mapped':
      case 'match':
      case 'error':
        return { kind: 'none', reason: undefined };
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  #nominal(type: NominalType): FormOrNone {
    const { checker } = this.#seams;
    const { declaration } = type.entity;
    if (this.#declaresCodecs(type)) {
      return { kind: 'none', reason: undefined };
    }
    if (declaration.kind === 'ExternStructDeclaration') {
      return this.#extern(type, declaration.isSendable);
    }
    if (declaration.kind === 'SharedStructDeclaration') {
      return { kind: 'none', reason: handleHasNoForm };
    }
    if (declaration.kind === 'StructDeclaration') {
      return this.#record(type, checker.fieldsOf(type) ?? []);
    }
    if (declaration.kind === 'EnumDeclaration') {
      return this.#enum(type);
    }
    return { kind: 'none', reason: undefined };
  }

  /**
   * An extern type: a host type is its host's JSON when it is declared sendable, or kept in a
   * resource when a `dispose` makes it disposable (§7); anything else has nothing to derive from.
   */
  #extern(type: NominalType, isSendable: boolean): FormOrNone {
    const { checker } = this.#seams;
    const isHost = isHostType(checker, type);
    if (isHost && (isSendable || checker.disposalOf(type).kind === 'function')) {
      return { kind: 'host', type };
    }
    return {
      kind: 'none',
      reason: isHost
        ? 'a JSON form, which a host type has when declared sendable or disposable'
        : handleHasNoForm,
    };
  }

  /** Whether a codec either way is declared for `type`. */
  #declaresCodecs(type: NominalType): boolean {
    const { checker } = this.#seams;
    return Object.values(jsonTraits).some((trait) =>
      declaresWitness(checker, type, wellKnownConstraint(checker, trait)),
    );
  }

  #record(type: StructValueType, fields: readonly FieldMember[]): FormOrNone {
    return { kind: 'record', type, fields: fields.map((field) => this.#field(field)) };
  }

  #enum(type: NominalType): FormOrNone {
    const variants = (this.#seams.checker.variantsOf(type) ?? []).map((variant) => ({
      name: variant.name,
      fields: variant.fields.map((field) => this.#field(field)),
    }));
    const colliding = variants.find((variant) =>
      variant.fields.some((field) => field.key === variantTagKey),
    );
    return colliding === undefined
      ? { kind: 'enum', type, variants }
      : {
          kind: 'none',
          reason: `no field named '${variantTagKey}' in JSON, which names the variant, as '${colliding.name}' has`,
        };
  }

  #field(field: FieldMember): JsonField {
    const { annotations } = this.#seams;
    return {
      name: field.name,
      key: annotations.jsonNameOf(field),
      type: field.type,
      skipped: annotations.fieldHas(field, 'jsonSkip')
        ? this.skippedDefaultOf(field.type)
        : undefined,
      optional: optionalInner(field.type) !== undefined,
      codec: annotations.fieldHas(field, 'jsonBigInt')
        ? {
            write: this.callOf(codecHelpers.encodeBigInt, []),
            read: this.callOf(codecHelpers.decodeBigInt, []),
          }
        : undefined,
    };
  }

  /**
   * The call to the json module's function `name` with `typeArguments`, made in the json module;
   * a derived codec or a helper always applies, so failing is a bug in the toolchain.
   */
  #jsonCall(name: CodecName, typeArguments: readonly Type[]): FunctionCall {
    const { checker } = this.#seams;
    const candidates = checker
      .languageFunctions('json', name)
      .map((declaration) => ({ declaration }));
    const call = callWithTypes(checker, candidates, typeArguments);
    if (call === undefined) {
      unreachable(`The json module's '${name}' doesn't take the types it was given.`);
    }
    return call;
  }
}

/** The form of `union` when its members are literals, grouped by base; undefined otherwise. */
function literalsForm(union: UnionType): DerivedForm | undefined {
  const literals = union.members.filter((member) => member.kind === 'literal');
  if (literals.length < union.members.length) {
    return undefined;
  }
  const groups: { base: Type; literals: LiteralType[] }[] = [];
  for (const literal of literals) {
    const base = baseOf(literal);
    const group = groups.find((each) => sameType(each.base, base));
    if (group === undefined) {
      groups.push({ base, literals: [literal] });
    } else {
      group.literals.push(literal);
    }
  }
  return { kind: 'literals', type: union, groups };
}

/** The parts a derived codec writes and reads through their own types' codecs. */
function partsOf(form: Exclude<DerivedForm, { kind: 'host' }>): readonly Part[] {
  const crossing = (fields: readonly JsonField[]): readonly Part[] =>
    fields
      .filter((field) => field.skipped === undefined && field.codec === undefined)
      .map((field) => ({ name: `field '${field.name}'`, type: field.type }));
  switch (form.kind) {
    case 'record':
      return crossing(form.fields);
    case 'enum':
      return form.variants.flatMap((variant) => crossing(variant.fields));
    case 'tuple':
      return form.type.elements.map((type, index) => ({ name: `element ${index}`, type }));
    case 'literals':
      return form.groups.map(({ base }) => ({ name: 'base', type: base }));
    default: {
      const unhandled: never = form;
      return unhandled;
    }
  }
}
