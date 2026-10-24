/**
 * The one walk over a top-level constant's initializer (§3): it decides what compile time computes
 * and computes it, in the same switch, so the two can't disagree. Compile time computes literals, a
 * negated number among them, duration literals, structs given every field by name, and other
 * top-level constants; anything else is refused where it stands, and arrays and maps are named as
 * not supported yet as constants.
 */

import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../../syntax/node.ts';
import type { CheckedBody, CheckedConstant, FieldMember } from '../check.ts';
import { type ConstantForm, durationForm } from '../constant-form.ts';
import { type FrontierConstruct, frontier } from '../frontier.ts';
import type { NominalType } from '../types/type.ts';

/** What the walk reads: the initializer's checking, struct layouts, and the other constants. */
export interface ComputationScope {
  readonly checked: CheckedBody;
  readonly fieldsOf: (type: NominalType) => readonly FieldMember[] | undefined;
  readonly constantNamed: (name: Identifier) => CheckedConstant | undefined;
}

/** How computing a part of an initializer went. */
export type Outcome =
  | { readonly kind: 'computed'; readonly form: ConstantForm }
  /** Compile time doesn't compute `part`; `notYet` names it when it is one not supported yet. */
  | { readonly kind: 'refused'; readonly part: NodeOf<string>; readonly notYet?: FrontierConstruct }
  /** An error a diagnostic already explained leaves no value. */
  | { readonly kind: 'unknown' };

const unknown: Outcome = { kind: 'unknown' };

/** What compile time makes of `initializer`. */
export function computeConstant(initializer: Expression, scope: ComputationScope): Outcome {
  return new Computation(scope).of(initializer);
}

class Computation {
  readonly #scope: ComputationScope;

  constructor(scope: ComputationScope) {
    this.#scope = scope;
  }

  of(node: Expression): Outcome {
    switch (node.kind) {
      case 'IntegerLiteral':
      case 'FloatLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return computed({ kind: 'primitive', value: node.value });
      case 'DurationLiteral':
        return this.#nominal(node, (type) => computed(durationForm(type, node.value)));
      case 'Parenthesized':
        return this.of(node.expression);
      case 'Unary':
        return node.operator === '-' && isNumberLiteral(node.operand)
          ? negated(this.of(node.operand))
          : refused(node);
      case 'Identifier': {
        const constant = this.#scope.constantNamed(node);
        if (constant === undefined) {
          return refused(node);
        }
        return constant.form === undefined ? unknown : computed(constant.form);
      }
      case 'StructLiteral':
        return this.#struct(node);
      case 'ArrayLiteral':
      case 'MapLiteral':
        return { kind: 'refused', part: node, notYet: frontier.arrayOrMapConstant };
      case 'Missing':
      case 'Invalid':
        return unknown;
      default:
        return refused(node);
    }
  }

  /** A struct given every field by name, its fields in declaration order. */
  #struct(node: StructLiteral): Outcome {
    const given = new Map<string, ConstantForm>();
    for (const item of node.items) {
      if (item.kind === 'Invalid') {
        return unknown;
      }
      if (item.kind !== 'FieldInitializer' || item.value === undefined) {
        return refused(item);
      }
      const field = this.of(item.value);
      if (field.kind !== 'computed') {
        return field;
      }
      given.set(item.name.text, field.form);
    }
    return this.#nominal(node, (type) => {
      const fields = (this.#scope.fieldsOf(type) ?? []).map(({ name }) => given.get(name));
      return fields.every((field) => field !== undefined)
        ? computed({ kind: 'struct', type, fields })
        : unknown;
    });
  }

  /** `build` applied to the nominal type the checker gave `node`; unknown after a reported error. */
  #nominal(node: Expression, build: (type: NominalType) => Outcome): Outcome {
    const type = this.#scope.checked.typeOf(node);
    return type.kind === 'nominal' ? build(type) : unknown;
  }
}

function computed(form: ConstantForm): Outcome {
  return { kind: 'computed', form };
}

function refused(part: NodeOf<string>): Outcome {
  return { kind: 'refused', part };
}

/** A number literal, possibly parenthesized: what compile time negates. */
function isNumberLiteral(node: Expression): boolean {
  if (node.kind === 'Parenthesized') {
    return isNumberLiteral(node.expression);
  }
  return node.kind === 'IntegerLiteral' || node.kind === 'FloatLiteral';
}

function negated(operand: Outcome): Outcome {
  if (operand.kind !== 'computed') {
    return operand;
  }
  const { value } = operand.form.kind === 'primitive' ? operand.form : { value: undefined };
  return typeof value === 'bigint' || typeof value === 'number'
    ? computed({ kind: 'primitive', value: -value })
    : unknown;
}
