/**
 * Codecs (§3.10, §9; docs/arch/boundary.md): a type crosses as JSON through its `toJson` and
 * `fromJson`, what `Encodable` and `Decodable` require, found as any witness is (conformance.ts).
 * A struct, an enum, a tuple or a host type declaring neither has both derived by the compiler from
 * its form, decided here once per type, which lowering writes the derived codecs from.
 *
 * - A struct is an object of its fields, an enum the same with a tag naming the variant
 *   (`variantTagKey`), a tuple an array, a host type whatever JSON its host gave it.
 * - What a struct, an enum or a tuple holds crosses through its own codecs, which are coherent
 *   witnesses (§3.10), so a derived codec is the same wherever its type is used.
 * - A codec declared for a type is a witness found as any is: beside the type, or in the json
 *   module, which declares them for primitives, `Json` and the prelude's containers. Declaring
 *   either leaves nothing derived, so no type is written one way and read another.
 * - A derived codec exists when everything it holds meets the trait. A
 *   recursive type counts as meeting it while its own parts are decided, as Sendable does.
 * - What has no codec says why, in words a diagnostic finishes ("it needs …"): a nested optional,
 *   whose two nones JSON can't tell apart; an enum with a field named as the tag; a function; a
 *   handle.
 */

import {
  type CodecHelper,
  type CodecName,
  codecFunctions,
  codecHelpers,
  derivedCodecs,
  wellKnown,
} from '../../../../language/well-known.ts';
import { memo } from '../../../../structures/memo.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import { isSharedStruct } from '../../../syntax/declarations.ts';
import type { CheckerContext } from '../../context.ts';
import { isHostType } from '../../host-externs.ts';
import {
  type DerivedCodec,
  type DerivedForm,
  type JsonCodecs,
  type JsonDirection,
  type JsonField,
  jsonTraits,
  variantTagKey,
} from '../../json-form.ts';
import { witnessesFor } from '../../resolution/conformance.ts';
import { declaresWitness } from '../../resolution/declared-witness.ts';
import { callWithTypes } from '../../resolution/typed-call.ts';
import type { FunctionCall, ResolvedCall } from '../../resolved-call.ts';
import { wellKnownConstraint } from '../../traits/constraints.ts';
import type { FieldMember, NominalType, Type } from '../../types/type.ts';
import { wellKnownArguments } from '../../types/well-known.ts';
import { hostSite, searchSite, silent, type UseSite } from '../../use-site.ts';
import type { Annotations } from '../annotations.ts';

/**
 * Why a handle has no codec, a std one such as a slot or a shared struct alike: its values have an
 * identity of their own (§3.1, §3.18).
 */
const handleHasNoForm = 'a JSON form, which no handle has: it stays in its instance';

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

export class JsonForms implements JsonCodecs {
  readonly #seams: JsonFormSeams;
  readonly #forms = new Map<string, DerivedForm>();
  /** The derived codecs being decided, by direction and type key, which count as found meanwhile. */
  readonly #deciding = new Set<string>();

  constructor(seams: JsonFormSeams) {
    this.#seams = seams;
  }

  formOf(type: Type): DerivedForm {
    return memo(this.#forms, this.#seams.checker.typeKeys.typeKey(type), () => this.#form(type));
  }

  refusalOf(type: Type): string | undefined {
    const { checker } = this.#seams;
    const [inner] = wellKnownArguments(checker, wellKnown.optional, type) ?? [];
    return inner !== undefined && wellKnownArguments(checker, wellKnown.optional, inner)
      ? 'no optional directly inside it, since JSON has one null for both its nones'
      : undefined;
  }

  derivedOf(site: UseSite, type: Type, direction: JsonDirection): DerivedCodec {
    const form = this.formOf(type);
    if (form.kind === 'none') {
      const trait = wellKnownConstraint(this.#seams.checker, jsonTraits[direction]).trait.name.text;
      const required = `'${codecFunctions[direction]}' as ${trait}`;
      return { kind: 'lacking', missing: form.reason ?? `${required} declares it` };
    }
    const key = `${direction} ${this.#seams.checker.typeKeys.typeKey(type)}`;
    if (!this.#deciding.has(key)) {
      this.#deciding.add(key);
      try {
        const missing = this.#partMissing(site, form, direction);
        if (missing !== undefined) {
          return { kind: 'lacking', missing };
        }
      } finally {
        this.#deciding.delete(key);
      }
    }
    return { kind: 'derived', call: this.#jsonCall(derivedCodecs[direction], [type]) };
  }

  /** The first part of `form` that doesn't meet the trait of `direction`, said as it lacks. */
  #partMissing(
    site: UseSite,
    form: Exclude<DerivedForm, { kind: 'none' }>,
    direction: JsonDirection,
  ): string | undefined {
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
    if (checker.program.roles.json === undefined) {
      return undefined;
    }
    const constraint = wellKnownConstraint(checker, jsonTraits[direction]);
    return witnessesFor(hostSite(searchSite(checker)), type, constraint)?.[0];
  }

  callOf(name: CodecHelper, typeArguments: readonly Type[]): FunctionCall {
    return this.#jsonCall(name, typeArguments);
  }

  #form(type: Type): DerivedForm {
    switch (type.kind) {
      case 'tuple':
        return { kind: 'tuple', elements: type.elements };
      case 'anonymous':
        return this.#record(type.fields);
      case 'nominal':
        return this.#nominal(type);
      case 'function':
        return { kind: 'none', reason: 'a JSON form, which no function has' };
      case 'any':
        return { kind: 'none', reason: "a JSON form, which no 'any' type has" };
      case 'primitive':
      case 'parameter':
      case 'error':
        return { kind: 'none', reason: undefined };
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  #nominal(type: NominalType): DerivedForm {
    const { checker } = this.#seams;
    const { declaration } = type.entity;
    if (this.#declaresCodecs(type)) {
      return { kind: 'none', reason: undefined };
    }
    if (declaration.kind === 'ExternStructDeclaration') {
      return this.#extern(type, declaration.isSendable);
    }
    if (isSharedStruct(declaration)) {
      return { kind: 'none', reason: handleHasNoForm };
    }
    if (declaration.kind === 'StructDeclaration') {
      return this.#record(checker.fieldsOf(type) ?? []);
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
  #extern(type: NominalType, isSendable: boolean): DerivedForm {
    const { checker } = this.#seams;
    const isHost = isHostType(checker, type);
    if (isHost && (isSendable || checker.disposalOf(type).kind === 'function')) {
      return { kind: 'host' };
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

  #record(fields: readonly FieldMember[]): DerivedForm {
    return { kind: 'record', fields: fields.map((field) => this.#field(field)) };
  }

  #enum(type: NominalType): DerivedForm {
    const variants = (this.#seams.checker.variantsOf(type) ?? []).map((variant) => ({
      name: variant.name,
      fields: variant.fields.map((field) => this.#field(field)),
    }));
    const colliding = variants.find((variant) =>
      variant.fields.some((field) => field.key === variantTagKey),
    );
    return colliding === undefined
      ? { kind: 'enum', variants }
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
      skipped: annotations.skippedDefaultOf(field),
      optional:
        wellKnownArguments(this.#seams.checker, wellKnown.optional, field.type) !== undefined,
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

/** The parts a derived codec writes and reads through their own types' codecs. */
function partsOf(form: Exclude<DerivedForm, { kind: 'host' | 'none' }>): readonly Part[] {
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
      return form.elements.map((type, index) => ({ name: `element ${index}`, type }));
    default: {
      const unhandled: never = form;
      return unhandled;
    }
  }
}
