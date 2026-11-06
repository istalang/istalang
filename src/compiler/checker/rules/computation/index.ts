/**
 * The one walk over a top-level constant's initializer (§3): it decides what compile time computes
 * and computes it, in the same switch, so the two can't disagree. Compile time computes literals, a
 * negated number and a template without values among them, duration literals, tuples (including a
 * value converted to or from a one-element tuple, §3.15), structs in every literal form (a spread
 * copying a computed struct's fields), a struct without fields written bare, arrays and maps of
 * `Map`, lambdas, which capture nothing at the top level (§3.14), and other top-level constants;
 * a struct's value converted into its shape (§3.1); anything else, a map literal of another type,
 * a shared struct's `new`, an enum variant, or a value needing an optional wrap, an `any`
 * conversion or an async function fit among them, is refused where it stands (forms.ts).
 *
 * A spread spreads only an array or a map compile time built itself: its elements, or its entries
 * as tuples. Anything else iterable is iterated by `iterate` when the program runs, and computing
 * it here would be a second home for what the runtime's `iterate` does.
 *
 * A field a struct literal leaves to its default (§3.1) is computed by the same walk over the
 * default, in its declaration's module, read through the literal's type arguments, with the fields
 * before it as computed: it is computed when the default is, and refused where it isn't, as a
 * default calling a function is. A default reached again while it is being computed builds a value
 * needing itself, which would never be finished, so it is refused as endless.
 */

import type { Diagnostic } from '../../../../diagnostics/diagnostic.ts';
import type { VariableOwner } from '../../../binder/entities.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type {
  ArrayLiteral,
  Expression,
  Lambda,
  MapLiteral,
  Spread,
  StructLiteral,
} from '../../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../../syntax/expressions/literals/numbers.ts';
import { constantTextOf } from '../../../syntax/expressions/literals/templates.ts';
import type { Identifier } from '../../../syntax/node.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { CheckedConstant } from '../../check.ts';
import type { CheckerContext } from '../../context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { CheckedBody, FieldSource } from '../../surface/checked-body.ts';
import { type ConstantForm, durationForm, formSemantics } from '../../surface/constant-form.ts';
import type { FunctionCall } from '../../surface/resolved-call.ts';
import { laidOut } from '../../types/field-order.ts';
import { isExact } from '../../types/fitting/fit.ts';
import { type Substitution, substitute, substitutionFor } from '../../types/substitution.ts';
import { computed, fittedForm, itemsOf, type Outcome, pairOf, refused, unknown } from './forms.ts';

/** What the walk reads: layouts, field defaults, the constant or annotation checked, and others. */
export interface ComputationScope {
  readonly checker: Pick<
    CheckerContext,
    | 'fieldsOf'
    | 'parametersOf'
    | 'defaultsOf'
    | 'moduleOf'
    | 'bindings'
    | 'constantNamed'
    | 'typeRules'
  >;
  readonly constant: VariableDeclaration | undefined;
  readonly checked: CheckedBody;
  readonly valueNamed: (name: Identifier) => CheckedConstant | undefined;
}

/** What compile time makes of `initializer`. */
export function computeConstant(initializer: Expression, scope: ComputationScope): Outcome {
  return new Computation(scope, new Map(), new Map()).of(initializer);
}

/** Why compile time leaves `outcome` uncomputed, reported where its part stands. */
export function refusalOf(
  outcome: Extract<Outcome, { readonly kind: 'refused' }>,
  notConstant: (at: AnchoredSpan) => Diagnostic<AnchoredSpan>,
): Diagnostic<AnchoredSpan> {
  return outcome.why === 'endless'
    ? checkerDiagnostics.endlessDefault(outcome.part.span)
    : notConstant(outcome.part.span);
}

class Computation {
  readonly #scope: ComputationScope;
  readonly #computing: Map<FunctionDeclaration, Set<number>>;
  readonly #substitution: Substitution;

  constructor(
    scope: ComputationScope,
    computing: Map<FunctionDeclaration, Set<number>>,
    substitution: Substitution,
  ) {
    this.#scope = scope;
    this.#computing = computing;
    this.#substitution = substitution;
  }

  of(node: Expression): Outcome {
    const outcome = this.#own(node);
    return outcome.kind === 'computed' ? this.#fitted(node, outcome.form) : outcome;
  }

  #own(node: Expression): Outcome {
    switch (node.kind) {
      case 'IntegerLiteral':
      case 'FloatLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return computed({ kind: 'primitive', value: node.value });
      case 'NoneLiteral':
        // `none` is the one value of `None`, written as `null`, as `Unit`'s is (§2).
        return computed({ kind: 'primitive', value: null });
      case 'TemplateLiteral': {
        const text = constantTextOf(node);
        return text === undefined ? refused(node) : computed({ kind: 'primitive', value: text });
      }
      case 'DurationLiteral': {
        const type = this.#scope.checked.typeOf(node);
        return type?.kind === 'nominal' ? computed(durationForm(type, node.value)) : unknown;
      }
      case 'Parenthesized':
        return this.of(node.expression);
      case 'Unary': {
        const number = signedNumberOf(node);
        return number === undefined
          ? refused(node)
          : computed({ kind: 'primitive', value: number.value });
      }
      case 'Identifier': {
        const constant = this.#scope.valueNamed(node);
        if (constant === undefined) {
          return this.#bareStruct(node);
        }
        return constant.form === undefined ? unknown : computed(constant.form);
      }
      case 'StructLiteral':
        return this.#struct(node);
      case 'IndentedValue': {
        const literal = this.#scope.checked.builtLiteralOf(node);
        return literal === undefined ? unknown : this.of(literal);
      }
      case 'Tuple':
        return this.#tuple(node.elements);
      case 'ArrayLiteral':
        return this.#array(node);
      case 'MapLiteral':
        return this.#map(node);
      case 'Lambda':
        return this.#lambda(node);
      case 'Missing':
      case 'Invalid':
        return unknown;
      default:
        return refused(node);
    }
  }

  /** Applies the implicit conversion recorded at `node`, or refuses one only the runtime makes. */
  #fitted(node: Expression, form: ConstantForm): Outcome {
    const converted = fittedForm(form, this.#scope.checked.fitAt(node), this.#scope.checker);
    return converted === undefined ? refused(node) : computed(converted);
  }

  /** A lambda's function value, when it captures nothing: a closure of no captures. */
  #lambda(node: Lambda): Outcome {
    const checked = this.#scope.checked.functionOf(node);
    const { constant } = this.#scope;
    if (checked === undefined) {
      return unknown;
    }
    return checked.captures.length === 0 && constant !== undefined
      ? computed({ kind: 'function', lambda: node, constant })
      : refused(node);
  }

  /**
   * A struct in any literal form, its fields computed in declaration order, then laid out by name
   * (§3.1 "Field order"); `new`'s cell is refused.
   */
  #struct(node: StructLiteral): Outcome {
    const sources = node.items.some((item) => item.kind === 'Invalid')
      ? undefined
      : this.#scope.checked.sourcesOf(node);
    if (sources === undefined) {
      return unknown;
    }
    const type = this.#scope.checked.typeOf(node);
    if (type?.kind === 'nominal' && type.entity.declaration.kind === 'EnumDeclaration') {
      return refused(node);
    }
    const fields = type === undefined ? undefined : this.#scope.checker.fieldsOf(type);
    if (
      type === undefined ||
      fields === undefined ||
      (type.kind !== 'nominal' && type.kind !== 'anonymous')
    ) {
      return unknown;
    }
    const forms = new Map<string, ConstantForm>();
    for (const source of sources) {
      if (source.kind === 'comprehension') {
        return refused(node);
      }
      const part = this.#field(node, source, [...forms.values()]);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.set(source.field, part.form);
    }
    return computed({ kind: 'struct', type, fields: laidOut(fields, forms) });
  }

  /** A field of `literal` from `source`; a refused default is reported at `literal`. */
  #field(
    literal: StructLiteral,
    source: Exclude<FieldSource, { readonly kind: 'comprehension' }>,
    earlier: readonly ConstantForm[],
  ): Outcome {
    switch (source.kind) {
      case 'value':
        return this.of(source.value);
      case 'spread':
        return this.#spreadField(source);
      case 'default': {
        const part = this.#default(source.call, earlier);
        return part.kind === 'refused' ? { ...part, part: literal } : part;
      }
      default: {
        const unhandled: never = source;
        return unhandled;
      }
    }
  }

  /** The default `call` gives the field after `earlier` (syntax/declarations/field-defaults.ts). */
  #default(call: FunctionCall, earlier: readonly ConstantForm[]): Outcome {
    const { checker } = this.#scope;
    const declaration = call.function;
    const parameters = checker.parametersOf(declaration);
    const field = earlier.length;
    const value = parameters[field]?.node.defaultValue;
    const checked = checker.defaultsOf(declaration);
    if (value === undefined || checked === undefined) {
      return unknown;
    }
    const computing = this.#computing.get(declaration) ?? new Set<number>();
    if (computing.has(field)) {
      return { kind: 'refused', part: value, why: 'endless' };
    }
    computing.add(field);
    this.#computing.set(declaration, computing);
    const outcome = this.#defaultValue(call, value, checked, earlier);
    computing.delete(field);
    return outcome;
  }

  /** The default `value` of `call`'s field, checked as `checked`, from the fields `earlier`. */
  #defaultValue(
    call: FunctionCall,
    value: Expression,
    checked: CheckedBody,
    earlier: readonly ConstantForm[],
  ): Outcome {
    const { checker } = this.#scope;
    const declaration = call.function;
    const parameters = checker.parametersOf(declaration);
    const module = checker.moduleOf(declaration);
    const typeArguments = call.typeArguments.map((type) =>
      substitute(type, this.#substitution, checker.typeRules),
    );
    const substitution = substitutionFor(declaration.typeParameters, typeArguments);
    const fields = new Map<VariableOwner, CheckedConstant>(
      parameters.slice(0, earlier.length).map((parameter, index) => [
        parameter.node,
        {
          type: substitute(parameter.type, substitution, checker.typeRules),
          form: earlier[index],
        },
      ]),
    );
    const scope: ComputationScope = {
      checker,
      constant: undefined,
      checked: checked.instantiated(substitution, checker),
      valueNamed: (name) => {
        const entity = checker.bindings.entityOf(module, name);
        const field = entity?.kind === 'variable' ? fields.get(entity.owner) : undefined;
        return field ?? checker.constantNamed(module, name);
      },
    };
    return new Computation(scope, this.#computing, substitution).of(value);
  }

  /** The field at `index` of a spread value, which must itself compute to a struct. */
  #spreadField(source: { readonly from: Expression; readonly index: number }): Outcome {
    const whole = this.of(source.from);
    if (whole.kind !== 'computed') {
      return whole;
    }
    const field = whole.form.kind === 'struct' ? whole.form.fields[source.index] : undefined;
    return field === undefined ? unknown : computed(field);
  }

  #tuple(elements: readonly Expression[]): Outcome {
    if (elements.length === 0) {
      return computed({ kind: 'primitive', value: null });
    }
    const forms: ConstantForm[] = [];
    for (const element of elements) {
      const part = this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.push(part.form);
    }
    return computed({ kind: 'tuple', elements: forms });
  }

  /**
   * An array of its elements and spreads' items; `[]` where a `Map` is expected is an empty map.
   */
  #array(node: ArrayLiteral): Outcome {
    const form = this.#scope.checked.collectionFormOf(node);
    if (form !== 'array') {
      return form === 'map' ? computed({ kind: 'map', entries: [] }) : refused(node);
    }
    const elements: ConstantForm[] = [];
    for (const element of node.elements) {
      const part = element.kind === 'Spread' ? this.#items(element) : this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      elements.push(...(element.kind === 'Spread' ? itemsOf(part.form) : [part.form]));
    }
    return computed({ kind: 'array', elements });
  }

  /** A map of its entries in order, a later equal key replacing the value (§2). */
  #map(node: MapLiteral): Outcome {
    if (this.#scope.checked.collectionFormOf(node) !== 'map') {
      return refused(node);
    }
    const pairs: (readonly [ConstantForm, ConstantForm])[] = [];
    for (const entry of node.entries) {
      const part = this.#entry(entry);
      if (part.kind !== 'computed') {
        return part;
      }
      pairs.push(...itemsOf(part.form).flatMap(pairOf));
    }
    return computed(formSemantics.mapOf(pairs));
  }

  /** What one entry of a map literal adds: something whose items are `(key, value)` tuples. */
  #entry(entry: MapLiteral['entries'][number]): Outcome {
    if (entry.kind === 'Invalid') {
      return unknown;
    }
    if (entry.kind === 'Spread') {
      return this.#items(entry);
    }
    const pair = this.#tuple([entry.key, entry.value]);
    return pair.kind === 'computed' ? computed({ kind: 'array', elements: [pair.form] }) : pair;
  }

  /**
   * What a spread spreads: a computed array or map, its items read with `itemsOf`. Items wrapped as
   * they are added are refused, as a wrapped element is.
   */
  #items(spread: Spread): Outcome {
    const spreading = this.of(spread.expression);
    if (spreading.kind !== 'computed') {
      return spreading;
    }
    const { kind } = spreading.form;
    const isExactItems = isExact(this.#scope.checked.fitAt(spread));
    return (kind === 'array' || kind === 'map') && isExactItems ? spreading : refused(spread);
  }

  /** A struct without fields named bare (§3.1); any other name that isn't a constant is refused. */
  #bareStruct(node: Identifier): Outcome {
    const type = this.#scope.checked.typeOf(node);
    return type?.kind === 'nominal' && this.#scope.checker.fieldsOf(type)?.length === 0
      ? computed({ kind: 'struct', type, fields: [] })
      : refused(node);
  }
}
