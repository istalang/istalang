/**
 * Codecs (§3.10, §9; docs/arch/boundary.md): a type crosses as JSON through its `toJson` and
 * `fromJson`, what `Encodable` and `Decodable` require, found as any witness is (conformance.ts).
 * A struct, an enum, a tuple or a host type declaring neither has both derived by the compiler from
 * its form, decided here once per type, which lowering writes the derived codecs from.
 *
 * - A struct is an object of its fields, an enum the same with a `"type"` tag naming the variant, a
 *   tuple an array, a host type whatever JSON its host gave it.
 * - What a struct or an enum holds crosses through the codecs found in its own module, so a
 *   derived codec is its type's alone; a tuple and an anonymous struct, which have no module, find
 *   theirs in the json module.
 * - A type declares codecs beside it: in its own module, or in the json module, which does for
 *   primitives, `Json` and the prelude's containers. Declaring either leaves nothing derived, so no
 *   type is written one way and read another.
 * - A derived codec exists when everything it holds meets the trait where its codecs are found. A
 *   recursive type counts as meeting it while its own parts are decided, as Sendable does.
 * - What has no codec says why, in words a diagnostic finishes ("it needs …"): a nested optional,
 *   whose two nones JSON can't tell apart; an enum with a field named `type`, which the tag uses; a
 *   function; a handle.
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
import { isStdModule, type ModuleId } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations.ts';
import type { FunctionCall, ResolvedCall } from '../../check.ts';
import type { CheckerContext, StaticOwner } from '../../context.ts';
import {
  type DerivedCodec,
  type DerivedForm,
  type JsonCodecs,
  type JsonDirection,
  type JsonField,
  jsonTraits,
} from '../../json-form.ts';
import { witnessesFor } from '../../resolution/conformance.ts';
import { callWithTypes } from '../../resolution/typed-call.ts';
import { wellKnownConstraint } from '../../traits/constraints.ts';
import type { FieldMember, NominalType, Type } from '../../types/type.ts';
import { wellKnownArguments } from '../../types/well-known.ts';
import { hostSite, silent, type UseSite, useSite } from '../../use-site.ts';
import type { Annotations } from '../annotations.ts';

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
    const inner = silent({ ...site, module: form.module });
    const constraint = wellKnownConstraint(this.#seams.checker, jsonTraits[direction]);
    const failing = partsOf(form).find(
      ({ type }) => witnessesFor(inner, type, constraint) === undefined,
    );
    return failing === undefined
      ? undefined
      : `its ${failing.name} to be ${constraint.trait.name.text}`;
  }

  codecOf(type: Type, direction: JsonDirection, module: ModuleId): ResolvedCall | undefined {
    const { checker } = this.#seams;
    if (checker.program.roles.json === undefined) {
      return undefined;
    }
    const constraint = wellKnownConstraint(this.#seams.checker, jsonTraits[direction]);
    const site = hostSite(silent(useSite(checker, module, constraint.trait.name.span)));
    return witnessesFor(site, type, constraint)?.[0];
  }

  callOf(name: CodecHelper, typeArguments: readonly Type[]): FunctionCall {
    return this.#jsonCall(name, typeArguments);
  }

  #form(type: Type): DerivedForm {
    switch (type.kind) {
      case 'tuple':
        return { kind: 'tuple', module: this.#jsonModule(), elements: type.elements };
      case 'anonymous':
        return this.#record(type.fields, this.#jsonModule());
      case 'nominal':
        return this.#nominal(type);
      case 'function':
        return { kind: 'none', reason: 'a JSON form, which no function has' };
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
    const module = checker.moduleOf(declaration);
    if (this.#declaresCodecs(declaration, module)) {
      return { kind: 'none', reason: undefined };
    }
    if (declaration.kind === 'ExternStructDeclaration') {
      return this.#host(type, declaration.isSendable, module);
    }
    if (declaration.kind === 'StructDeclaration') {
      return this.#record(checker.fieldsOf(type) ?? [], module);
    }
    if (declaration.kind === 'EnumDeclaration') {
      return this.#enum(type, module);
    }
    return { kind: 'none', reason: undefined };
  }

  /**
   * An extern type: a host type is its host's JSON when it is declared sendable, or kept in a
   * resource when a `dispose` makes it disposable (§7); anything else has nothing to derive from.
   */
  #host(type: NominalType, isSendable: boolean, module: ModuleId): DerivedForm {
    const { checker } = this.#seams;
    const isHost = !isStdModule(checker.program, module);
    if (isHost && (isSendable || checker.disposalOf(type).kind === 'function')) {
      return { kind: 'host' };
    }
    return {
      kind: 'none',
      reason: isHost
        ? 'a JSON form, which a host type has when declared sendable or disposable'
        : 'a JSON form, which no handle has: it stays in its instance',
    };
  }

  /** Whether a codec of `declaration` is declared beside it, or in the json module. */
  #declaresCodecs(declaration: StaticOwner, module: ModuleId): boolean {
    const { checker } = this.#seams;
    return [...new Set([module, this.#jsonModule()])].some(
      (each) =>
        checker
          .staticFunctionsIn(each, declaration)
          .some((function_) => function_.name.text === codecFunctions.read) ||
        this.#functionsNamed(each, codecFunctions.write).some(
          (function_) => this.#selfOf(function_) === declaration,
        ),
    );
  }

  #functionsNamed(module: ModuleId, name: string): readonly FunctionDeclaration[] {
    const { bindings } = this.#seams.checker;
    const entity = bindings.topLevelNamed(module, name);
    return entity?.kind === 'functions' ? bindings.overloadsOf(entity) : [];
  }

  /** The declaration of the type a function's first parameter has, when it is nominal. */
  #selfOf(function_: FunctionDeclaration): StaticOwner | undefined {
    const [self] = this.#seams.checker.parametersOf(function_);
    return self?.type.kind === 'nominal' ? self.type.entity.declaration : undefined;
  }

  #record(fields: readonly FieldMember[], module: ModuleId): DerivedForm {
    return { kind: 'record', module, fields: fields.map((field) => this.#field(field)) };
  }

  #enum(type: NominalType, module: ModuleId): DerivedForm {
    const variants = (this.#seams.checker.variantsOf(type) ?? []).map((variant) => ({
      name: variant.name,
      fields: variant.fields.map((field) => this.#field(field)),
    }));
    const colliding = variants.find((variant) =>
      variant.fields.some((field) => field.key === 'type'),
    );
    return colliding === undefined
      ? { kind: 'enum', module, variants }
      : {
          kind: 'none',
          reason: `no field named 'type' in JSON, which names the variant, as '${colliding.name}' has`,
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
    const call = callWithTypes(checker, candidates, typeArguments, this.#jsonModule());
    if (call === undefined) {
      unreachable(`The json module's '${name}' doesn't take the types it was given.`);
    }
    return call;
  }

  /** The json module, which every type crossing as JSON needs. */
  #jsonModule(): ModuleId {
    const { json } = this.#seams.checker.program.roles;
    if (json === undefined) {
      unreachable('A codec was asked of a program without the json module.');
    }
    return json;
  }
}

/** The parts a derived codec writes and reads through their own types' codecs. */
function partsOf(form: Extract<DerivedForm, { module: ModuleId }>): readonly Part[] {
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
