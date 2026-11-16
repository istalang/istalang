/**
 * Writing `json._toJson<T>` (codecs.ts): its one parameter is the value, and it returns the `Json`.
 * A struct is an object of its fields, `@JsonSkip` ones left out, whose keys are sorted when it is
 * written; an enum the same, with its variant's tag; a tuple an array; a host type the JSON its
 * host gave, through the json module's helper; a literal its base's value, a union of literals' the
 * tag's literal (§2). Each part is written by its own type's codec, and a literal by its base's.
 * `Json` is a recursive union (§3.17), so what is built goes into it as the member it is: an array
 * of `Json`, a map of `Json` by `String`, or a `String`.
 */

import type { Register } from '../../../../definition/operands.ts';
import { codecHelpers } from '../../../../foundation/language/well-known/codecs.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import {
  type DerivedForm,
  type JsonField,
  variantTagKey,
} from '../../../checker/surface/json-form.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type { Type, UnionType } from '../../../checker/types/type/index.ts';
import { isPrimitive, stringType } from '../../../checker/types/type/primitives.ts';
import { arrayElement, wellKnownArguments } from '../../../checker/types/type/well-known.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import { closeCall } from '../../calls/closed-calls.ts';
import type { TypedValue } from '../../values/holdings.ts';
import { eachMember, intoUnion } from '../../values/unions.ts';
import type { SynthesizedCode } from '../index.ts';
import { codecCall } from './codec-calls.ts';

/** The body of `_toJson<T>`, written into `code`. */
export class Encoder {
  readonly #code: SynthesizedCode;
  readonly #json: UnionType;

  constructor(code: SynthesizedCode, json: Type) {
    this.#code = code;
    const union = unfolded(json);
    this.#json = union.kind === 'union' ? union : unreachable('Json is a union.');
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
        code.return(
          this.#object(form.fields, (index, field) => code.structField(value, index, field.type), []),
        );
        return;
      case 'tuple': {
        const items = form.type.elements.map((element, index) =>
          code.call(this.#codec(element), [code.tupleItem(value, index, element)]),
        );
        code.return(this.#list(items));
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
      ? eachMember(code, { register: value, type }, { result: this.#json, span: code.span }, write)
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
        const tag = this.#member(
          (member) => isPrimitive(member, 'String'),
          code.constant(variant.name, stringType),
        );
        const read = (position: number, field: JsonField) =>
          code.variantField(value, index, position, field.type);
        code.return(
          this.#object(variant.fields, read, [[code.constant(variantTagKey, stringType), tag]]),
        );
      }
    }
  }

  /** The `Json.Object` of `fields`, each written by its codec, after `before`. */
  #object(
    fields: readonly JsonField[],
    read: (index: number, field: JsonField) => Register,
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
        return [[code.constant(field.key, stringType), code.call(encode, [read(index, field)])]];
      }),
    ];
    const { checker } = code;
    const isObject = (member: Type) => wellKnownArguments(checker, wellKnown.map, member) !== undefined;
    return this.#member(isObject, code.map(entries, this.#memberType(isObject)));
  }

  /** The `Json` of `items`, each a `Json`. */
  #list(items: readonly Register[]): Register {
    const { checker } = this.#code;
    const isList = (member: Type) => arrayElement(checker, member) !== undefined;
    return this.#member(isList, this.#code.array(items, this.#memberType(isList)));
  }

  /** The member of `Json` that `isMember` picks. */
  #memberType(isMember: (member: Type) => boolean): Type {
    return this.#json.members.find(isMember) ?? unreachable('Json has no such member.');
  }

  /** `value`, of the member of `Json` that `isMember` picks, as a `Json`. */
  #member(isMember: (member: Type) => boolean, value: Register): Register {
    const member = this.#memberType(isMember);
    return intoUnion(this.#code, { register: value, type: member }, this.#json, this.#code.span);
  }
}
