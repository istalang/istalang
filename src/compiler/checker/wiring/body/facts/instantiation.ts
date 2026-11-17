/**
 * What one instantiation does to each part a checked body records (§3.5): a body is checked once,
 * generically, so what runs for one instantiation reads it with every type it records substituted.
 * The body's facts table (index.ts) says which part each fact is made of; the parts are substituted
 * here. The calls a body records stay as checked: closing one takes the instantiation's witnesses
 * too, which its reader has, so the reader closes it (lowering, through surface/witness-closing.ts;
 * rules/computation/ for a default's). Lowering reads a function instance's body this way, and
 * compile time a field's default for the literal running it.
 */

import { memo } from '../../../../../foundation/structures/memo.ts';
import type { Checker } from '../../../check.ts';
import type { FlowSource } from '../../../rules/flow/build/index.ts';
import type {
  AssignedPart,
  ChainLink,
  CheckedFunction,
  FieldPass,
  IterationForm,
} from '../../../surface/checked-body.ts';
import { type FieldRead, keyedFieldRead, namedFieldRead } from '../../../surface/checked-field.ts';
import type {
  CheckedPattern,
  PartStep,
  PatternTest,
  StructStep,
  TargetBinding,
  TargetStep,
} from '../../../surface/checked-pattern.ts';
import type { Fit } from '../../../types/fitting/fit/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substituteConstraint,
  substituteKept,
} from '../../../types/parts/substitution.ts';
import { keyName } from '../../../types/traits/struct-keys.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import { inFieldOrder } from '../../../types/type/field-order.ts';
import type { FieldMember, ParameterKey, Type } from '../../../types/type/index.ts';
import { membersOf } from '../../../types/type/index.ts';
import { isPrimitive, literalType } from '../../../types/type/primitives.ts';
import type { TypeRules } from '../../../types/type/type-rules.ts';

/** One instantiation: each kind of part a body records, as it reads it. */
export interface Instantiation {
  readonly substitution: Substitution;
  readonly checker: Pick<Checker, 'fieldNamed' | 'typeRules'>;
  /** A type as substituted, a recursive one unfolded (§3.17): what an expression is read as. */
  readonly concrete: (type: Type) => Type;
  readonly fit: (fit: Fit) => Fit;
  readonly field: (field: FieldMember) => FieldMember;
  readonly fieldRead: (read: FieldRead) => FieldRead;
  readonly target: (binding: TargetBinding) => TargetBinding;
  readonly assigned: (part: AssignedPart) => AssignedPart;
  readonly function: (checked: CheckedFunction) => CheckedFunction;
  readonly pattern: (checked: CheckedPattern) => CheckedPattern;
  readonly iteration: (form: IterationForm) => IterationForm;
  readonly chain: (link: ChainLink) => ChainLink;
  /**
   * A field loop's passes: each one's key and value substituted, and its body read the same way;
   * the pass of the fields a struct constraint leaves unnamed, once they are all known, one pass per
   * field, every pass then in field order (§3.1), as the loop runs them.
   */
  readonly passes: (passes: readonly FieldPass[]) => readonly FieldPass[];
  /** What a body's flows are built from: its roots' parameters and its calls' results substituted. */
  readonly flows: (source: FlowSource) => FlowSource;
}

/** The instantiation `substitution` makes, for reading a body checked once (§3.5). */
export function instantiationBy(
  substitution: Substitution,
  checker: Pick<Checker, 'fieldNamed' | 'typeRules'>,
): Instantiation {
  const rules = checker.typeRules;
  // A body reads one type at many nodes, and lowering reads each node's again and again.
  const concreteTypes = new WeakMap<Type, Type>();
  const concrete = (type: Type) =>
    memo(concreteTypes, type, () => unfolded(substitute(type, substitution, rules)));
  return {
    substitution,
    checker,
    concrete,
    fit: (fit) => substitutedFit(fit, substitution, rules),
    field: (field) => ({ ...field, type: concrete(field.type) }),
    fieldRead: (read) => instantiatedRead(checker, read, { concrete, substitution }),
    target: (binding) => instantiatedTarget(binding, substitution, rules),
    assigned: (part) => instantiatedPart(part, substitution, rules),
    function: (checked) => instantiatedFunction(checked, substitution, rules),
    pattern: (checked) => instantiatedPattern(checked, substitution, rules),
    iteration: (form) => ({ ...form, item: concrete(form.item) }),
    chain: (link) => ({ base: concrete(link.base), carried: concrete(link.carried) }),
    flows: ({ module, concrete: read, roots }) => ({
      module,
      concrete: (type) => concrete(read(type)),
      roots: roots.map(({ root, parameters }) => ({
        root,
        parameters: parameters.map((parameter) => ({
          ...parameter,
          type: concrete(parameter.type),
        })),
      })),
    }),
    passes: (passes) => {
      const split = passes.flatMap((pass) => {
        const known = knownFields(pass, substitution, rules);
        return known === undefined
          ? [instantiatedPass(pass, substitution, checker)]
          : known.names.map((name) =>
              instantiatedPass(
                { ...pass, visits: { kind: 'field', name } },
                new Map([...substitution, [known.key, literalType(name)]]),
                checker,
              ),
            );
      });
      const named = split.flatMap((pass) =>
        pass.visits.kind === 'field' ? [{ name: pass.visits.name, pass }] : [],
      );
      return named.length === split.length ? inFieldOrder(named).map(({ pass }) => pass) : split;
    },
  };
}

/** `pass` read through `substitution`: its key, value and body. */
function instantiatedPass(
  { visits, key, value, body }: FieldPass,
  substitution: Substitution,
  checker: Pick<Checker, 'fieldNamed' | 'typeRules'>,
): FieldPass {
  const rules = checker.typeRules;
  return {
    visits,
    key: substitute(key, substitution, rules),
    value: substitute(value, substitution, rules),
    body: body.instantiated(substitution, checker),
  };
}

/**
 * The names of the fields the pass of the others ranges over once `substitution` knows them all
 * (§4), and the key standing for each; undefined for any other pass, or while some are unknown.
 */
function knownFields(
  { visits, key }: FieldPass,
  substitution: Substitution,
  rules: TypeRules,
): { readonly names: readonly string[]; readonly key: ParameterKey } | undefined {
  if (visits.kind !== 'others' || key.kind !== 'parameter') {
    return undefined;
  }
  const ranged = substitute(key, substitution, rules);
  const members =
    ranged.kind === 'parameter' && ranged.within !== undefined ? membersOf(ranged.within) : [];
  const names = members.flatMap((member) =>
    isPrimitive(member, 'Never') ? [] : [keyName(member)],
  );
  return members.length > 0 && names.every((name): name is string => name !== undefined)
    ? { names, key: key.declaration }
    : undefined;
}

/** A part an assignment writes, its path, type and fit substituted. */
function instantiatedPart(
  part: AssignedPart,
  substitution: Substitution,
  rules: TypeRules,
): AssignedPart {
  const path = instantiatedTargetPath(part.path, substitution, rules);
  const type = substitute(part.type, substitution, rules);
  if (part.kind === 'unnamed') {
    return { ...part, path, type };
  }
  const { fit } = part;
  return {
    ...part,
    path,
    type,
    fit: fit === 'intoKeyedField' ? fit : substitutedFit(fit, substitution, rules),
  };
}

/** A lambda or local function of the body with every type it records substituted. */
function instantiatedFunction(
  checked: CheckedFunction,
  substitution: Substitution,
  rules: TypeRules,
): CheckedFunction {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return {
    type: substituteKept(checked.type, substitution, rules),
    result: concrete(checked.result),
    parameters: checked.parameters.map((parameter) => ({
      ...parameter,
      type: concrete(parameter.type),
    })),
    captures: checked.captures.map((captured) => ({ ...captured, type: concrete(captured.type) })),
  };
}

/** What a target binds, as one instantiation sees it: its type and its path's types substituted. */
function instantiatedTarget(
  binding: TargetBinding,
  substitution: Substitution,
  rules: TypeRules,
): TargetBinding {
  return {
    ...binding,
    type: substitute(binding.type, substitution, rules),
    path: instantiatedTargetPath(binding.path, substitution, rules),
  };
}

/**
 * A target's or an assignment's path as one instantiation sees it: its struct steps' types
 * substituted.
 */
function instantiatedTargetPath(
  path: readonly TargetStep[],
  substitution: Substitution,
  rules: TypeRules,
): readonly TargetStep[] {
  return path.map((step) =>
    typeof step === 'number' ? step : instantiatedStructStep(step, substitution, rules),
  );
}

/**
 * `checked` with every type it records substituted, in its or-patterns' alternatives too. Each test
 * and step kind is listed, so a kind that comes to carry a type can't pass through unsubstituted.
 *
 * A union a member test tests may collapse (§3.5): `T | Int` with `T = Int` is `Int`. Its value is
 * then the member's own value, with no variant around it: the `member` step into it carries the
 * union, substituted here, so whoever reads the path sees the collapse, and a name narrowed from
 * it reads the value as it is.
 */
function instantiatedPattern(
  checked: CheckedPattern,
  substitution: Substitution,
  rules: TypeRules,
): CheckedPattern {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  const path = (steps: readonly PartStep[]) =>
    steps.map((step) => instantiatedStep(step, substitution, rules));
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          path: path(patternTest.path),
          from: substituteAny(patternTest.from, substitution, rules),
          to: concrete(patternTest.to),
        };
      case 'member':
        return {
          ...patternTest,
          path: path(patternTest.path),
          union: unfolded(concrete(patternTest.union)),
          members: patternTest.members.flatMap((member) => membersOf(concrete(member))),
        };
      case 'or':
        return {
          ...patternTest,
          alternatives: patternTest.alternatives.map((each) =>
            instantiatedPattern(each, substitution, rules),
          ),
        };
      case 'variant':
      case 'equal':
      case 'compare':
        return { ...patternTest, path: path(patternTest.path) };
      case 'never':
        return patternTest;
      default: {
        const unhandled: never = patternTest;
        return unhandled;
      }
    }
  };
  return {
    tests: checked.tests.map(instantiatedTest),
    bindings: checked.bindings.map(({ narrowedFrom, ...binding }) => {
      const type = concrete(binding.type);
      const from = narrowedFrom === undefined ? undefined : concrete(narrowedFrom);
      return {
        ...binding,
        path: path(binding.path),
        type,
        narrowedFrom: from === undefined || sameType(from, type) ? undefined : from,
      };
    }),
  };
}

/** `step` with the type it carries substituted. */
function instantiatedStep(step: PartStep, substitution: Substitution, rules: TypeRules): PartStep {
  if (typeof step === 'number') {
    return step;
  }
  switch (step.kind) {
    case 'member':
      return {
        kind: 'member',
        union: unfolded(substitute(step.union, substitution, rules)),
        member: substitute(step.member, substitution, rules),
      };
    case 'field':
    case 'fieldRest':
      return instantiatedStructStep(step, substitution, rules);
    case 'variantField':
      return { ...step, type: substitute(step.type, substitution, rules) };
    case 'downcast':
      return { ...step, to: substitute(step.to, substitution, rules) };
    case 'length':
    case 'item':
    case 'rest':
      return step;
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** A struct step with the types it carries substituted: an instantiation decides what they are. */
function instantiatedStructStep(
  step: StructStep,
  substitution: Substitution,
  rules: TypeRules,
): StructStep {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return step.kind === 'field'
    ? { ...step, of: concrete(step.of) }
    : { kind: 'fieldRest', from: concrete(step.from), to: concrete(step.to) };
}

/**
 * `fit` as one instantiation makes it: the type a conversion converts into, substituted. A union
 * the value goes into may collapse into one type (§3.5): a value that went in as a member then is
 * a value of that type already, its own or a literal of it, which is its base's value; one that
 * went in member by member was a union of that type's literals, or that type, taken as its base.
 * A union collapsing into an `any` type took the value's type whole (§2), so the value still goes
 * into it, as lowering derives.
 */
function substitutedFit(
  { conversion, into }: Fit,
  substitution: Substitution,
  rules: TypeRules,
): Fit {
  const substituted = substitutedConversion(conversion, substitution, rules);
  if (into === undefined) {
    return { conversion: substituted };
  }
  // A recursive union substituted is its use again (§3.17); the value goes into what it unfolds to.
  const union = unfolded(substitute(into.union, substitution, rules));
  const member =
    into.member === undefined ? undefined : substitute(into.member, substitution, rules);
  if (union.kind === 'union' || union.kind === 'any') {
    return { conversion: substituted, into: { union, member } };
  }
  return { conversion: member === undefined ? { kind: 'base' } : substituted };
}

function substitutedConversion(
  conversion: Fit['conversion'],
  substitution: Substitution,
  rules: TypeRules,
) {
  switch (conversion.kind) {
    case 'any':
      return { kind: 'any', to: substituteAny(conversion.to, substitution, rules) } as const;
    case 'shape':
      return { kind: 'shape', to: substituteKept(conversion.to, substitution, rules) } as const;
    case 'parts':
      return { kind: 'parts', to: substitute(conversion.to, substitution, rules) } as const;
    case 'async':
      return { kind: 'async', to: substituteKept(conversion.to, substitution, rules) } as const;
    default:
      return conversion;
  }
}

/**
 * `read` as an instantiation reaches it, each type it reads through made `concrete`, a required
 * field's constraint substituted alike.
 */
function instantiatedRead(
  checker: Pick<Checker, 'fieldNamed' | 'typeRules'>,
  read: FieldRead,
  { concrete, substitution }: Pick<Instantiation, 'concrete' | 'substitution'>,
): FieldRead {
  switch (read.kind) {
    case 'position':
      return { ...read, on: concrete(read.on) };
    case 'required': {
      const constraint = substituteConstraint(
        read.required.constraint,
        substitution,
        checker.typeRules,
      );
      return { ...read, on: concrete(read.on), required: { ...read.required, constraint } };
    }
    case 'named':
      return namedFieldRead(checker, concrete(read.on), read.name);
    case 'keyed':
      return keyedFieldRead(checker, concrete(read.on), concrete(read.key));
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}
