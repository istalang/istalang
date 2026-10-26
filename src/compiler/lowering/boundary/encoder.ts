/**
 * Writing `json._toJson<T>` (codecs.ts): its one parameter is the value, and it returns the `Json`.
 * A struct is an object of its fields, `@JsonSkip` ones left out, whose keys are sorted when it is
 * written; an enum the same, with its `"type"` tag; a tuple an array; a host type the JSON its host
 * gave, through the json module's helper. Each part is written by its own type's codec.
 */

import type { Register } from '../../../definition/operands.ts';
import { codecHelpers, jsonVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { DerivedForm, JsonField } from '../../checker/json-form.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import type { ModuleId } from '../../program/program.ts';
import { variantIndexOf } from '../expressions/variants.ts';
import { codecCall } from './codec-calls.ts';
import type { SynthesizedCode } from './synthesized-code.ts';

/** The body of `_toJson<T>`, written into `code`. */
export class Encoder {
  readonly #code: SynthesizedCode;
  readonly #json: NominalType;

  constructor(code: SynthesizedCode, json: NominalType) {
    this.#code = code;
    this.#json = json;
  }

  write(form: DerivedForm, type: Type): void {
    const code = this.#code;
    const [value] = code.parameters;
    if (value === undefined) {
      unreachable('An encoder takes the value it writes.');
    }
    switch (form.kind) {
      case 'host':
        code.return(
          code.call(code.checker.json.callOf(codecHelpers.encodeHandle, [type]), [value]),
        );
        return;
      case 'record':
        code.return(
          this.#object(form.fields, form.module, (index) => code.field(value, index), []),
        );
        return;
      case 'tuple': {
        const items = form.elements.map((element, index) =>
          code.call(this.#codec(element, form.module), [code.field(value, index)]),
        );
        code.return(this.#variant(jsonVariants.list, [code.array(items)]));
        return;
      }
      case 'enum':
        this.#enum(form, value, type);
        return;
      case 'none':
        unreachable('A type with nothing to derive from has a derived codec.');
        return;
      default: {
        const unhandled: never = form;
        unreachable(`No encoder for ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /** The codec writing `type`, as found in `module`. */
  #codec(type: Type, module: ModuleId) {
    return codecCall(this.#code.checker, { module, within: undefined }, type, 'write');
  }

  /** One branch per variant, each writing its tag and fields. */
  #enum(form: Extract<DerivedForm, { kind: 'enum' }>, value: Register, type: Type): void {
    const code = this.#code;
    if (type.kind !== 'nominal') {
      unreachable('An enum form is of a nominal type.');
    }
    const labels = form.variants.map(() => code.code.newLabel());
    code.code.switch(value, labels, code.span);
    for (const [index, variant] of form.variants.entries()) {
      const label = labels[index];
      if (label !== undefined) {
        code.code.place(label);
        const tag = code.constant(this.#text(variant.name));
        code.return(
          this.#object(variant.fields, form.module, (field) => code.field(value, field), [
            [code.constant('type'), tag],
          ]),
        );
      }
    }
  }

  /** The `Json.Object` of `fields`, each written by its codec found in `module`, after `before`. */
  #object(
    fields: readonly JsonField[],
    module: ModuleId,
    read: (index: number) => Register,
    before: readonly (readonly [Register, Register])[],
  ): Register {
    const code = this.#code;
    const entries = [
      ...before,
      ...fields.flatMap((field, index): (readonly [Register, Register])[] => {
        if (field.skipped !== undefined) {
          return [];
        }
        const encode = field.codec?.write ?? this.#codec(field.type, module);
        return [[code.constant(field.key), code.call(encode, [read(index)])]];
      }),
    ];
    return this.#variant(jsonVariants.object, [code.map(entries)]);
  }

  #variant(name: string, fields: readonly Register[]): Register {
    return this.#code.variant(this.#json, name, fields);
  }

  /** `Json.Text{name}`, as a constant. */
  #text(name: string) {
    const { checker, tables } = this.#code;
    return {
      kind: 'variant' as const,
      type: tables.typeIndex(this.#json),
      variant: variantIndexOf(checker, this.#json, jsonVariants.text),
      fields: [name],
    };
  }
}
