/**
 * Writing `json._fromJson<T>` (codecs.ts): its parameters are the `Json` and its path, and it
 * returns a `Result<T>`. It reads the way the encoder writes, stopping at the first part that
 * doesn't fit: each part's codec and each helper returns a `Result`, and an `Err` is passed on as
 * this codec's own, with the path it names. A literal type, or a union of literals, reads its base
 * and accepts only a value equal to one of its literals. A field the JSON lacks is `none` when its type is
 * optional, and an `Err` otherwise; a `@JsonSkip` field is never read and gets its type's
 * `default()`.
 */

import type { Register } from '../../../definition/operands.ts';
import { type CodecHelper, codecHelpers, resultVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type DerivedForm, type JsonField, variantTagKey } from '../../checker/json-form.ts';
import type { LiteralType, NominalType, Type } from '../../checker/types/type.ts';
import { typeText } from '../../checker/types/type-text.ts';
import { type ClosedCall, closeCall } from '../instances.ts';
import type { SynthesizedCode } from '../synthesized-code.ts';
import { literalValue, oneValueIn } from '../unions.ts';
import { codecCall } from './codec-calls.ts';

/** The body of `_fromJson<T>`, written into `code`. */
export class Decoder {
  readonly #code: SynthesizedCode;
  readonly #result: NominalType;

  constructor(code: SynthesizedCode, result: NominalType) {
    this.#code = code;
    this.#result = result;
  }

  read(form: DerivedForm): void {
    const code = this.#code;
    const [json, path] = code.parameters;
    if (json === undefined || path === undefined) {
      unreachable('A decoder takes the Json it reads and its path.');
    }
    switch (form.kind) {
      case 'host': {
        const decode = this.#helper(codecHelpers.decodeHandle, [form.type]);
        code.return(code.call(decode, [json, path]));
        return;
      }
      case 'record': {
        const fields = this.#passed(code.call(this.#helper(codecHelpers.fields), [json, path]));
        const values = this.#fields(form.fields, { object: fields, path });
        code.return(this.#ok(code.struct(form.type, values)));
        return;
      }
      case 'tuple': {
        const { elements } = form.type;
        const count = code.constant(BigInt(elements.length));
        const items = this.#passed(
          code.call(this.#helper(codecHelpers.elements), [json, path, count]),
        );
        const values = elements.map((element, index) => {
          const position = code.constant(BigInt(index));
          const item = code.call(this.#helper(codecHelpers.element), [items, position]);
          const at = code.call(this.#helper(codecHelpers.elementPath), [path, position]);
          return this.#passed(code.call(this.#codec(element), [item, at]));
        });
        code.return(this.#ok(code.tuple(values)));
        return;
      }
      case 'enum':
        this.#enum(form, json, path);
        return;
      case 'literals':
        this.#literals(form, json, path);
        return;
      default: {
        const unhandled: never = form;
        unreachable(`No decoder for ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /** The codec reading `type`. */
  #codec(type: Type): ClosedCall {
    return codecCall(this.#code.checker, undefined, type, 'read');
  }

  /** The variant its tag names, each variant tried in order, else an `Err`. */
  #enum(form: Extract<DerivedForm, { kind: 'enum' }>, json: Register, path: Register): void {
    const code = this.#code;
    const { type } = form;
    const fields = this.#passed(code.call(this.#helper(codecHelpers.fields), [json, path]));
    const key = code.constant(variantTagKey);
    const tag = this.#passed(code.call(this.#helper(codecHelpers.tag), [fields, key, path]));
    for (const variant of form.variants) {
      const matched = code.code.newLabel();
      const next = code.code.newLabel();
      code.code.branch(code.equal(tag, code.constant(variant.name)), matched, next, code.span);
      code.code.place(matched);
      code.return(
        this.#ok(
          code.variant(type, variant.name, [
            ...this.#fields(variant.fields, { object: fields, path }).values(),
          ]),
        ),
      );
      code.code.place(next);
    }
    code.return(code.call(this.#helper(codecHelpers.unknownVariant, [type]), [tag, key, path]));
  }

  /**
   * The literal the value read is: each base's codec reads it in turn, a base that can't moving on
   * to the next, and the value read is compared with that base's literals, else an `Err` naming
   * them all. A union of literals' member holds nothing; a lone literal type is its base's value (§2).
   */
  #literals(
    form: Extract<DerivedForm, { kind: 'literals' }>,
    json: Register,
    path: Register,
  ): void {
    const code = this.#code;
    const { type, groups } = form;
    const none = code.code.newLabel();
    for (const group of groups) {
      const next = code.code.newLabel();
      const read = code.call(this.#codec(group.base), [json, path]);
      const value = code.ok(read, this.#result, () => code.code.jump(next, code.span));
      for (const literal of group.literals) {
        const matched = code.code.newLabel();
        const other = code.code.newLabel();
        const equal = code.equal(value, code.constant(literalValue(literal)));
        code.code.branch(equal, matched, other, code.span);
        code.code.place(matched);
        code.return(
          this.#ok(type.kind === 'union' ? oneValueIn(code, type, literal, code.span) : value),
        );
        code.code.place(other);
      }
      code.code.jump(none, code.span);
      code.code.place(next);
    }
    code.code.place(none);
    const spelled = code.constant(literalsText(groups.flatMap(({ literals }) => literals)));
    code.return(code.call(this.#helper(codecHelpers.notAmong, [type]), [json, path, spelled]));
  }

  /**
   * Each field's value by its name, in the order of `fields`, read from `object` at `path` by its
   * codec or, when skipped, its type's `default()`.
   */
  #fields(
    fields: readonly JsonField[],
    { object, path }: { readonly object: Register; readonly path: Register },
  ): ReadonlyMap<string, Register> {
    return new Map(fields.map((field) => [field.name, this.#field(field, { object, path })]));
  }

  /** `field`'s value, as `#fields` reads it. */
  #field(
    field: JsonField,
    { object, path }: { readonly object: Register; readonly path: Register },
  ): Register {
    const code = this.#code;
    if (field.skipped !== undefined) {
      return code.call(closeCall(field.skipped, undefined), []);
    }
    const key = code.constant(field.key);
    const at = code.call(this.#helper(codecHelpers.fieldPath), [path, key]);
    const json = field.optional
      ? code.call(this.#helper(codecHelpers.optionalField), [object, key])
      : this.#passed(code.call(this.#helper(codecHelpers.field), [object, key, path]));
    const decode =
      field.codec === undefined ? this.#codec(field.type) : closeCall(field.codec.read, undefined);
    return this.#passed(code.call(decode, [json, at]));
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

  #helper(name: CodecHelper, typeArguments: readonly Type[] = []): ClosedCall {
    return closeCall(this.#code.checker.json.callOf(name, typeArguments), undefined);
  }
}

/** `literals` as a failure names what it expected: `"draft", "sent" or "failed"`. */
function literalsText(literals: readonly LiteralType[]): string {
  const spelled = literals.map((literal) => typeText(literal));
  const last = spelled.pop();
  return spelled.length === 0 ? (last ?? '') : `${spelled.join(', ')} or ${last}`;
}
