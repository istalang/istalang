/**
 * Instantiating a chosen function and meeting its constraints (§3.5, §3.10).
 *
 * - A chosen generic function's type parameters are settled from what inference found
 *   (types/inference/settle.ts), the call's expected type among it once the caller has given it
 *   (`Inference.expect`); one still open can't be inferred. Settling asks which types a parameter
 *   admits (`admitsAt`).
 * - Every type argument must meet its parameter's bounds, judged as parameter-bounds.ts judges
 *   them wherever an argument is given. A type meets a trait with the same
 *   functions wherever it is met: those the trait requires must be declared beside the types they
 *   take or beside the trait, or be a requirement of a type parameter's own constraints
 *   (resolution/choosing/candidates.ts). Each is the function declared to meet it
 *   (declared-witness.ts), which must give the required result. The calls found are the witnesses
 *   the instantiation calls (check.ts).
 * - A required field is met by a field of its name the type stores, of its type, or else by a
 *   getter chosen as a witness is, as `fn get name(self: Self)` giving that type (§3.10), a
 *   witness of the constraint after its functions', through which lowering reads the field once
 *   it knows the type. A required associated type, and a struct constraint's entries, are met as
 *   shortfalls.ts judges them.
 * - A trait the compiler derives (derived-traits.ts) asks what its rule asks of every type first,
 *   and a required function no function is declared for is met by the witness it derives. On a
 *   union, any other trait's is met through its members (union-traits.ts, §6).
 * - Struct-constraint field checks (shortfalls.ts) and union-member checks (`throughMembers`) are
 *   coinductive on the active search stack for concrete types: a `(struct, struct constraint)` or
 *   `(union, constraint)` goal already active counts as met (`silentMeets`). A search judges each
 *   goal once (witness-outcomes.ts `SearchGoals`), finding a failure again where its site reports.
 * - A goal asked at the root, a trait's or a struct constraint's, is searched once per program
 *   (`rootSearches`, kept by root-goals.ts), each site asking making its reports again. A call's
 *   instantiation asks its type arguments' goals there too (`rootGoalsAt`), so every call made with
 *   the same arguments shares one search; a witness's asks them within the search it is nested in
 *   (`searchGoalsAt`), whose active goals it must see.
 * - A requirement with type parameters of its own is met by a function generic in the same way:
 *   resolving the call with those parameters as opaque types infers the candidate's own.
 * - The required result is what the witness must give exactly, so a type parameter no argument
 *   decides comes from it: `Array.default<T>()` meets `Self.default()` for `Array<Int>` with `T`
 *   as `Int`.
 * - A witness search that fails is reported once, as the constraint not met, so searching itself
 *   reports nothing (`UseSite.report`). A search can recurse without end, when a witness needs
 *   the same constraint again for a type as large or larger; it is bounded, and one that reaches
 *   the bound is reported as such at the root use site.
 */

import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration, TypeParameter } from '../../../syntax/declarations/index.ts';
import type { RootGoals } from '../../contexts/context.ts';
import { silent, type UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { RequiredField } from '../../surface/checked-field.ts';
import type { ResolvedCall, Witnesses } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { type Completion, completeInference, settlingOf } from '../../types/inference/complete.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { type Substitution, substitute } from '../../types/parts/substitution.ts';
import { mentionsError } from '../../types/parts/type-parts.ts';
import {
  constraintSubstitution,
  requiredFunctions,
  traitAsAny,
} from '../../types/traits/constraints.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { callMade } from '../choosing/calls-made.ts';
import { type Application, type Choice, type Signature, signatureOf } from '../choosing/choice.ts';
import { admitting } from './admits.ts';
import {
  chooseFieldGetter,
  chooseWitness,
  chooseWitnessAmong,
  instanceMeetsKind,
  type RequiredSignature,
} from './declared-witness.ts';
import { type Derivation, derivationOf } from './derived-traits.ts';
import { kindsSettledAt } from './kind-settling.ts';
import { fieldGetters, lacks, type Meeting, meetingKey, metBy } from './meetings.ts';
import { boundWitnesses, parameterBounds } from './parameter-bounds.ts';
import { type ArgumentGoals, rootGoalsAt } from './root-goals.ts';
import { associatedShortfall, type Meets, meetsStructModel } from './shortfalls.ts';
import { type MembersMeeting, membersCall, membersShortfall } from './union-traits.ts';
import {
  boundReached,
  type ConformanceOutcome,
  deeper,
  endlessAt,
  type Failure,
  isFailure,
  maximumDepth,
  meetsWith,
  type Search,
  startSearch,
  type WitnessOutcome,
} from './witness-outcomes.ts';

/** A chosen function, complete: its type arguments, and the witnesses of its constraints. */
export interface Instantiation {
  readonly typeArguments: readonly Type[];
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
}

/**
 * Completes `application`: its type parameters settled, then every constraint met, its type
 * `match`es and its witnesses' noted to reduce. Undefined after reporting why it can't be.
 */
export function instantiate(site: UseSite, application: Application): Instantiation | undefined {
  const instantiation = instantiateAt(site, application);
  if (isFailure(instantiation)) {
    return undefined;
  }
  const { substitution, witnesses } = instantiation;
  site.instantiates(application.signature.declaration, substitution, witnesses);
  return instantiation;
}

/** `instantiate`, within the `search` a witness's instantiation is nested in, if any. */
function instantiateAt(
  site: UseSite,
  application: Application,
  search?: Search,
): Instantiation | Failure {
  const { checker } = site;
  const { signature, inference } = application;
  const { declaration, typeParameters } = signature;
  const settling = settlingAt(site, signature, search);
  const completion = completeInference(checker, typeParameters, inference, settling);
  if (completion.kind === 'open') {
    const parameter = completion.parameter.name.text;
    const name = declaredFunctionName(declaration);
    site.report((at) => checkerDiagnostics.cannotInfer(at, name, parameter));
    return 'failed';
  }
  const { typeArguments, substitution } = completion;
  const witnesses = witnessesOf(site, typeParameters, completion, search);
  return isFailure(witnesses) ? witnesses : { typeArguments, substitution, witnesses };
}

/** A witness's goals, asked within the `search` it is nested in. */
function searchGoalsAt(site: UseSite, search: Search): ArgumentGoals {
  return {
    witnesses: (type, constraint) => {
      const meeting = { site, type, constraint };
      return search.goals.witnessesReported(meetingKey(meeting), () => conform(meeting, search));
    },
    structMet: (type, model) => meetsStructModel(site, type, model, silentMeets(site, search)),
    unmet: () => (search.endless === undefined ? 'failed' : 'endless'),
  };
}

/**
 * The witnesses of every constraint on `parameters`, given their arguments, asked of the root goals
 * unless within a witness's `search`.
 */
function witnessesOf(
  site: UseSite,
  parameters: readonly TypeParameter[],
  { typeArguments, substitution }: Extract<Completion, { kind: 'complete' }>,
  search?: Search,
): Witnesses | Failure {
  const goals = search === undefined ? rootGoalsAt(site) : searchGoalsAt(site, search);
  const witnesses = new Map<TypeParameter, readonly (readonly ResolvedCall[])[]>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = typeArguments[index] ?? errorType;
    const bounds = parameterBounds(site.checker, parameter, substitution);
    const met = boundWitnesses(site, argument, bounds, goals);
    if (isFailure(met)) {
      return met;
    }
    witnesses.set(parameter, met);
  }
  return witnesses;
}

/**
 * How `signature`'s type parameters settle at `site`, within `search` (types/inference/settle.ts):
 * a type is admitted where it meets their constraints, asked as a probe reporting nothing. A
 * placeholder a candidate probes asks it before the call is instantiated
 * (constructs/expressions/postponed.ts).
 */
export function settlingAt(
  site: UseSite,
  signature: Signature,
  search: Search = startSearch(),
): Settling {
  const { declaration, typeParameters } = signature;
  const admits = admitting(site.checker, silentMeets(site, search));
  return kindsSettledAt(
    site,
    signature,
    settlingOf(site.checker, declaration, typeParameters, admits),
  );
}

/** Whether `type` meets `constraint` at the use site, reporting there when it doesn't. */
export function meets(site: UseSite, type: Type, constraint: Constraint): boolean {
  return witnessesFor(site, type, constraint) !== undefined;
}

/** The witness of every function `constraint` requires of `type` at `site`, or undefined. */
export function witnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  return site.checker.rootGoals.witnesses(site, { type, constraint, onValues: false });
}

/** How a goal is searched from its root at a site, which root-goals.ts keeps the answer of. */
export const rootSearches: RootGoals = {
  witnesses: (site, goal) => {
    const witnesses = conform({ site, ...goal }, startSearch());
    return isFailure(witnesses) ? undefined : witnesses;
  },
  structMet: (site, { type, model }) => meetsStructModel(site, type, model, silentMeets(site)),
};

/**
 * The witnesses a call through `constraint`'s trait on a value of `type`, a union, runs (§6): its
 * required functions, through its members or declared for it whole, with no associated type of the
 * union itself. Undefined after reporting at `site` why it can't be called so.
 */
export function callWitnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  return site.checker.rootGoals.witnesses(site, { type, constraint, onValues: true });
}

/**
 * The witnesses of `constraint` for `type`: `undeclared` without reporting when a required
 * function has no declared candidate, or `failed` after reporting at `site` why `type` doesn't
 * meet `constraint`.
 */
export function conformWitnesses(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): ConformanceOutcome {
  let undeclared = false;
  const witnesses = conform({ site, type, constraint }, startSearch(), () => {
    undeclared = true;
    return 'failed';
  });
  if (!isFailure(witnesses)) {
    return { kind: 'met', witnesses };
  }
  return undeclared ? { kind: 'undeclared' } : { kind: 'failed' };
}

/**
 * The witness of every function `constraint` requires of `type`, in the trait's order, then the
 * getter meeting each field it requires that the type stores none of; a function none is declared
 * for is `unmet`'s, by default the one a derived trait derives, else reported missing.
 */
function conform(
  meeting: Meeting,
  search: Search,
  unmet?: (declaration: FunctionDeclaration) => ResolvedCall | Failure,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  if (type.kind === 'error') {
    return 'failed';
  }
  const { checker } = site;
  const derivation = derivationOf(checker, constraint.trait);
  const missing =
    derivation?.lacking(site, type, constraint) ??
    (meeting.onValues === true
      ? undefined
      : associatedShortfall(checker, type, constraint, silentMeets(site, search)));
  if (missing !== undefined) {
    return search.endless === undefined
      ? lacks(meeting, missing)
      : endlessAt(site, search, type, constraint);
  }
  const getters = fieldGetters(meeting, search, (required) =>
    getterWitness(site, type, required, search),
  );
  if (isFailure(getters)) {
    return getters;
  }
  const functions = functionWitnesses(
    meeting,
    search,
    unmet ?? undeclaredWitness(meeting, derivation, search),
  );
  return isFailure(functions) ? functions : [...functions, ...getters];
}

/**
 * How a search judges traits and active goals (`Meets`, shortfalls.ts) without reporting unmet
 * ones.
 */
export function silentMeets(site: UseSite, search: Search = startSearch()): Meets {
  return meetsWith(site, search, (type, constraint) => {
    const meeting = { site: silent(site), type, constraint };
    return search.goals.witnesses(meetingKey(meeting), () => conform(meeting, deeper(search)));
  });
}

/**
 * What meets a required function no function is declared for: derived, union members, or missing.
 */
function undeclaredWitness(
  meeting: Meeting,
  derivation: Derivation | undefined,
  search: Search,
): (declaration: FunctionDeclaration) => ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  return (declaration) => {
    if (type.kind === 'union' && derivation?.derive === undefined) {
      const through = traitAsAny(constraint, type);
      return throughMembers(meeting, { union: type, through, declaration }, search);
    }
    const derived = derivation?.derive?.(site, type);
    if (derived?.kind === 'derived') {
      return derived.call;
    }
    const required = `'${declaration.name.text}' as ${constraint.trait.name.text} declares it`;
    return lacks(meeting, derived?.missing ?? required);
  };
}

/**
 * The witness of a required function a union meets through its members (`enter` is coinductive).
 */
function throughMembers(
  meeting: Meeting,
  members: MembersMeeting,
  search: Search,
): ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  const { checker } = site;
  const memberMeets = silentMeets(site, search);
  const shortfall = memberMeets.enter(members.union, constraint, () =>
    membersShortfall(checker, members, memberMeets),
  );
  if (shortfall !== undefined) {
    return search.endless === undefined ? lacks(meeting, shortfall) : 'endless';
  }
  const { union, through, declaration } = members;
  const index = requiredFunctions(constraint.trait).indexOf(declaration);
  const signature = signatureOf(checker, declaration, constraintSubstitution(constraint, type));
  const candidate = membersCall(checker.typeRules, union, through, { declaration, member: index });
  const choice = chooseWitnessAmong(checker, type, [candidate], signature);
  const witness = witnessChosen(site, choice, { type, signature }, search);
  if (witness.kind === 'call') {
    return witness.call;
  }
  return isFailure(witness.kind) ? witness.kind : 'failed';
}

function functionWitnesses(
  meeting: Meeting,
  search: Search,
  unmet: (declaration: FunctionDeclaration) => ResolvedCall | Failure,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  const substitution = constraintSubstitution(constraint, type);
  const witnesses: ResolvedCall[] = [];
  for (const declaration of requiredFunctions(constraint.trait)) {
    const required = { declaration, substitution };
    const witness: WitnessOutcome =
      search.depth < maximumDepth ? witnessOf(site, type, required, search) : boundReached(search);
    const met = metBy(meeting, search, witness, {
      name: declaration.name.text,
      unmet: () => unmet(declaration),
    });
    if (isFailure(met)) {
      return met;
    }
    witnesses.push(met);
  }
  return witnesses;
}

/** The getter meeting `required`'s field for `type`, which stores none of its name (§3.10). */
function getterWitness(
  site: UseSite,
  type: Type,
  required: RequiredField,
  search: Search,
): WitnessOutcome {
  if (search.depth >= maximumDepth) {
    return boundReached(search);
  }
  const { choice, signature } = chooseFieldGetter(site.checker, type, required);
  return witnessChosen(site, choice, { type, signature }, search);
}

interface RequiredFunction {
  readonly declaration: FunctionDeclaration;
  readonly substitution: Substitution;
}

function witnessOf(
  site: UseSite,
  type: Type,
  required: RequiredFunction,
  search: Search,
): WitnessOutcome {
  const signature = signatureOf(site.checker, required.declaration, required.substitution);
  const choice = chooseWitness(site.checker, type, signature);
  return witnessChosen(site, choice, { type, signature }, search);
}

function witnessChosen(
  site: UseSite,
  choice: Choice,
  { type, signature }: { readonly type: Type; readonly signature: RequiredSignature },
  search: Search,
): WitnessOutcome {
  if (choice.kind === 'none') {
    return { kind: 'none' };
  }
  if (choice.kind === 'several') {
    return { kind: 'ambiguous' };
  }
  const { application } = choice;
  const { inference, signature: chosen } = application;
  if (chosen.typeParameters.some((parameter) => inference.boundOf(parameter) === undefined)) {
    inference.matchExactly(chosen.result(), signature.result());
  }
  const instantiation = instantiateAt(site, application, deeper(search));
  if (isFailure(instantiation)) {
    return { kind: instantiation };
  }
  const result = substitute(
    application.signature.result(),
    instantiation.substitution,
    site.checker.typeRules,
  );
  const required = signature.result();
  if (!(mentionsError(required) || sameType(result, required))) {
    return { kind: 'wrongResult', required, given: result };
  }
  const call = callMade(application, instantiation);
  return instanceMeetsKind(site.checker, signature, call, type)
    ? { kind: 'call', call }
    : { kind: 'none' };
}
