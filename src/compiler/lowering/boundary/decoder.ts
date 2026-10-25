/**
 * Writing `json._decodeAt<T>` (codecs.ts): its parameters are the `Json` and its path, and it
 * returns a `Result<T>`. It reads the way the encoder writes, stopping at the first part that
 * doesn't fit: each helper and nested codec returns a `Result`, and an `Err` is passed on as this
 * codec's own, with the path it names. A field the JSON lacks is `none` when its type is optional,
 * and an `Err` otherwise; a `@JsonSkip` field is never read and gets its type's empty value.
 */

import type { Register } from '../../../definition/operands.ts';
import {
  type CodecHelper,
  codecHelpers,
  optionalVariants,
  resultVariants,
} from '../../../language/well-known.ts';
import type { FunctionCall } from '../../checker/check.ts';
import type { EmptyValue, JsonField, JsonForm } from '../../checker/rules/json-forms/form.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import type { SynthesizedCode } from './synthesized-code.ts';

/** The body of `_decodeAt<T>`, written into `code`. */
export class Decoder {
  readonly #code: SynthesizedCode;
  readonly #result: NominalType;

  constructor(code: SynthesizedCode, result: NominalType) {
    this.#code = code;
    this.#result = result;
  }

  read(form: JsonForm, type: Type): void {
    const code = this.#code;
    const { checker } = code;
    const [json, path] = code.parameters;
    if (json === undefined || path === undefined) {
      throw new Error('A decoder takes the Json it reads and its path.');
    }
    switch (form.kind) {
      case 'json':
        code.return(this.#ok(json));
        return;
      case 'leaf':
        code.return(code.call(decodeOf(form.codec.decode, type), [json, path]));
        return;
      case 'container':
        code.return(
          code.call(decodeOf(form.codec.decode, type), [
            json,
            path,
            code.closure(checker.json.decoderOf(form.element)),
          ]),
        );
        return;
      case 'record': {
        const fields = this.#passed(code.call(this.#helper(codecHelpers.fields), [json, path]));
        const values = this.#fields(form.fields, fields, path);
        code.return(this.#ok(this.#struct(type, values)));
        return;
      }
      case 'tuple': {
        const count = code.constant(BigInt(form.elements.length));
        const items = this.#passed(
          code.call(this.#helper(codecHelpers.elements), [json, path, count]),
        );
        const values = form.elements.map((element, index) => {
          const position = code.constant(BigInt(index));
          const item = code.call(this.#helper(codecHelpers.element), [items, position]);
          const at = code.call(this.#helper(codecHelpers.elementPath), [path, position]);
          return this.#passed(code.call(checker.json.decoderOf(element), [item, at]));
        });
        code.return(this.#ok(code.tuple(values)));
        return;
      }
      case 'enum':
        this.#enum(form.variants, type, json, path);
        return;
      case 'none':
        throw unreadable(type);
      default: {
        const unhandled: never = form;
        throw new Error(`No decoder for ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /** The variant its `"type"` names, each variant tried in order, else an `Err`. */
  #enum(
    variants: Extract<JsonForm, { kind: 'enum' }>['variants'],
    type: Type,
    json: Register,
    path: Register,
  ): void {
    const code = this.#code;
    if (type.kind !== 'nominal') {
      throw new Error('An enum form is of a nominal type.');
    }
    const fields = this.#passed(code.call(this.#helper(codecHelpers.fields), [json, path]));
    const tag = this.#passed(code.call(this.#helper(codecHelpers.tag), [fields, path]));
    for (const variant of variants) {
      const matched = code.code.newLabel();
      const next = code.code.newLabel();
      code.code.branch(code.equal(tag, code.constant(variant.name)), matched, next, code.span);
      code.code.place(matched);
      code.return(
        this.#ok(code.variant(type, variant.name, this.#fields(variant.fields, fields, path))),
      );
      code.code.place(next);
    }
    code.return(
      code.call(code.checker.json.callOf(codecHelpers.unknownVariant, [type]), [tag, path]),
    );
  }

  /** Each field's value, read from `fields` or, when skipped, its type's empty value. */
  #fields(fields: readonly JsonField[], object: Register, path: Register): readonly Register[] {
    const code = this.#code;
    return fields.map((field) => {
      if (field.skipped !== undefined) {
        return this.#empty(field.type, field.skipped);
      }
      const key = code.constant(field.key);
      const at = code.call(this.#helper(codecHelpers.fieldPath), [path, key]);
      const json = field.optional
        ? code.call(this.#helper(codecHelpers.optionalField), [object, key])
        : this.#passed(code.call(this.#helper(codecHelpers.field), [object, key, path]));
      const decode = field.codec?.decode ?? code.checker.json.decoderOf(field.type);
      return this.#passed(code.call(decode, [json, at]));
    });
  }

  /** The value of a skipped field of `type`, which reads back as `empty` (§9). */
  #empty(type: Type, empty: EmptyValue): Register {
    const code = this.#code;
    switch (empty) {
      case 'none':
        if (type.kind !== 'nominal') {
          throw new Error('An optional is a nominal type.');
        }
        return code.variant(type, optionalVariants.none, []);
      case 'array':
        return code.array([]);
      case 'map':
        return code.map([]);
      default: {
        const unhandled: never = empty;
        return unhandled;
      }
    }
  }

  #struct(type: Type, values: readonly Register[]): Register {
    if (type.kind !== 'nominal' && type.kind !== 'anonymous') {
      throw new Error('A record form is of a struct type.');
    }
    return this.#code.struct(type, values);
  }

  /** The value an `Ok` in `result` holds; an `Err` is returned as this codec's own. */
  #passed(result: Register): Register {
    const code = this.#code;
    return code.ok(result, this.#result, (error) => {
      code.return(code.variant(this.#result, resultVariants.err, [error]));
    });
  }

  #ok(value: Register): Register {
    return this.#code.variant(this.#result, resultVariants.ok, [value]);
  }

  #helper(name: CodecHelper): FunctionCall {
    return this.#code.checker.json.callOf(name, []);
  }
}

function decodeOf(decode: FunctionCall | undefined, type: Type): FunctionCall {
  if (decode === undefined) {
    throw unreadable(type);
  }
  return decode;
}

/** A type reached a decoder without a form to read, which the checker rules out. */
function unreadable(type: Type): Error {
  return new Error(`'${JSON.stringify(type)}' can't be read; the checker should have said so.`);
}
