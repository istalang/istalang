/**
 * Writing `json.encode<T>` (codecs.ts): its one parameter is the value, and it returns the `Json`.
 * A struct is an object of its fields, `@JsonSkip` ones left out, whose keys are sorted when it is
 * written; an enum the same, with its `"type"` tag; a tuple an array. Anything else is a call: a leaf's helper, or a
 * container's helper given the codec of what it holds as a function value.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { JsonField, JsonForm } from '../../checker/json-form.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import { variantIndexOf } from '../expressions/variants.ts';
import type { SynthesizedCode } from './synthesized-code.ts';

/** The body of `encode<T>`, written into `code`. */
export class Encoder {
  readonly #code: SynthesizedCode;
  readonly #json: NominalType;

  constructor(code: SynthesizedCode, json: NominalType) {
    this.#code = code;
    this.#json = json;
  }

  write(form: JsonForm, type: Type): void {
    const code = this.#code;
    const [value] = code.parameters;
    if (value === undefined) {
      unreachable('An encoder takes the value it writes.');
    }
    switch (form.kind) {
      case 'json':
      case 'none':
        // `json.Json` is its own JSON; a type with no form to write is `never`, which has no value.
        code.return(value);
        return;
      case 'leaf':
        code.return(code.call(form.codec.encode, [value]));
        return;
      case 'container':
        code.return(
          code.call(form.codec.encode, [
            value,
            code.closure(code.checker.json.encoderOf(form.element)),
          ]),
        );
        return;
      case 'record':
        code.return(this.#object(form.fields, (index) => code.field(value, index), []));
        return;
      case 'tuple': {
        const items = form.elements.map((element, index) =>
          code.call(code.checker.json.encoderOf(element), [code.field(value, index)]),
        );
        code.return(this.#variant('List', [code.array(items)]));
        return;
      }
      case 'enum':
        this.#enum(form.variants, value, type);
        return;
      default: {
        const unhandled: never = form;
        unreachable(`No encoder for ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /** One branch per variant, each writing its tag and fields. */
  #enum(
    variants: Extract<JsonForm, { kind: 'enum' }>['variants'],
    value: Register,
    type: Type,
  ): void {
    const code = this.#code;
    if (type.kind !== 'nominal') {
      unreachable('An enum form is of a nominal type.');
    }
    const labels = variants.map(() => code.code.newLabel());
    code.code.switch(value, labels, code.span);
    for (const [index, variant] of variants.entries()) {
      const label = labels[index];
      if (label !== undefined) {
        code.code.place(label);
        const tag = code.constant(this.#text(variant.name));
        code.return(
          this.#object(variant.fields, (field) => code.field(value, field), [
            [code.constant('type'), tag],
          ]),
        );
      }
    }
  }

  /** The `Json.Object` of `fields`, after the entries `before`. */
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
        const encode = field.codec?.encode ?? code.checker.json.encoderOf(field.type);
        return [[code.constant(field.key), code.call(encode, [read(index)])]];
      }),
    ];
    return this.#variant('Object', [code.map(entries)]);
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
      variant: variantIndexOf(checker, this.#json, 'Text'),
      fields: [name],
    };
  }
}
