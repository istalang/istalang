/**
 * Writing `json._toJson<T>` (codecs.ts): its one parameter is the value, and it returns the `Json`.
 * A struct is an object of its fields, `@JsonSkip` ones left out, whose keys are sorted when it is
 * written; an enum the same, with its variant's tag; a tuple an array; a host type the JSON its host
 * gave, through the json module's helper; a literal its base's value, a union of literals' the tag's
 * literal (§2). Each part is written by its own type's codec, and a literal by its base's.
 */

import type { Register } from '../../../definition/operands.ts';
import { codecHelpers, jsonVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type DerivedForm, type JsonField, variantTagKey } from '../../checker/json-form.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import { baseOf } from '../../checker/types/unions.ts';
import { closeCall } from '../closed-calls.ts';
import type { TypedValue } from '../holdings.ts';
import type { SynthesizedCode } from '../synthesized-code.ts';
import { eachMember } from '../unions.ts';
import { codecCall } from './codec-calls.ts';

/** The body of `_toJson<T>`, written into `code`. */
export class Encoder {
  readonly #code: SynthesizedCode;
  readonly #json: NominalType;

  constructor(code: SynthesizedCode, json: NominalType) {
    this.#code = code;
    this.#json = json;
  }

  write(form: DerivedForm): void {
    const code = this.#code;
    const [value] = code.parameters;
    if (value === undefined) {
      unreachable('An encoder takes the value it writes.');
    }
    switch (form.kind) {
      case 'host': {
        const encode = code.checker.json.callOf(codecHelpers.encodeHandle, [form.type]);
        code.return(code.call(closeCall(encode, undefined, code.checker), [value]));
        return;
      }
      case 'record':
        code.return(this.#object(form.fields, (index) => code.field(value, index), []));
        return;
      case 'tuple': {
        const items = form.type.elements.map((element, index) =>
          code.call(this.#codec(element), [code.field(value, index)]),
        );
        code.return(this.#variant(jsonVariants.list, [code.array(items)]));
        return;
      }
      case 'enum':
        this.#enum(form, value);
        return;
      case 'literals':
        code.return(this.#literal(form.type, value));
        return;
      default: {
        const unhandled: never = form;
        unreachable(`No encoder for ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /**
   * A literal's JSON, as its base's codec writes its value: a lone literal type is its base's value
   * already (§2), and a union of literals' member is written by its own literal's base.
   */
  #literal(type: Type, value: Register): Register {
    const code = this.#code;
    const write = (literal: TypedValue) =>
      code.call(this.#codec(baseOf(literal.type)), [literal.register]);
    return type.kind === 'union'
      ? eachMember(code, { register: value, type }, code.span, write)
      : write({ register: value, type });
  }

  /** The codec writing `type`. */
  #codec(type: Type) {
    return codecCall(this.#code.checker, undefined, type, 'write');
  }

  /** One branch per variant, each writing its tag and fields. */
  #enum(form: Extract<DerivedForm, { kind: 'enum' }>, value: Register): void {
    const code = this.#code;
    const labels = form.variants.map(() => code.code.newLabel());
    code.code.switch(value, labels, code.span);
    for (const [index, variant] of form.variants.entries()) {
      const label = labels[index];
      if (label !== undefined) {
        code.code.place(label);
        const tag = this.#variant(jsonVariants.text, [code.constant(variant.name)]);
        code.return(
          this.#object(variant.fields, (field) => code.field(value, field), [
            [code.constant(variantTagKey), tag],
          ]),
        );
      }
    }
  }

  /** The `Json.Object` of `fields`, each written by its codec, after `before`. */
  #object(
    fields: readonly JsonField[],
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
        const encode =
          field.codec === undefined
            ? this.#codec(field.type)
            : closeCall(field.codec.write, undefined, code.checker);
        return [[code.constant(field.key), code.call(encode, [read(index)])]];
      }),
    ];
    return this.#variant(jsonVariants.object, [code.map(entries)]);
  }

  #variant(name: string, fields: readonly Register[]): Register {
    return this.#code.variant(this.#json, name, fields);
  }
}
