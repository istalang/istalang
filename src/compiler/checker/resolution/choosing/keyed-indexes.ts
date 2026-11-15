/**
 * Keyed indexes (§3.9): an `index` taking a receiver as `self`, its constraints met, whose key is a
 * member parameter of String literals (`K in keyof S`, `K in "click" | "hover"`). Member syntax
 * reads through one: `x.k`, where `x`'s type has no member `k`, is `x["k"]` (member-meaning.ts).
 *
 * - The keys one takes are its member parameter's union as the receiver gives its type
 *   parameters, so `keyof S` on a `GroupScope<Supplier>` is Supplier's field names. An opaque
 *   receiver's keys hold the names its constraints give, and others no name serves.
 * - An `index` taking any `String`, as `Map<String, V>`'s does, is none: its key is no member
 *   parameter, so a map's members keep their meaning.
 *
 * A probe: it chooses nothing and reports nothing, so asking leaves no trace.
 */

import { collectionFunctions } from '../../../../foundation/language/well-known/implicit-calls.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { type Substitution, substitute } from '../../types/parts/substitution.ts';
import { isKeyWithin, keyName, memberUnionOf } from '../../types/traits/struct-keys.ts';
import { membersOf, type Type } from '../../types/type/index.ts';
import { isPrimitive, literalType } from '../../types/type/primitives.ts';
import type { SignatureSlot } from './call-arguments.ts';
import { type Candidate, topLevelCandidates } from './candidates.ts';
import { signatureOf } from './choice.ts';
import { metSelfInference } from './receivers.ts';

/** An `index` serving member names on a receiver, and the keys it takes there. */
export interface KeyedIndex {
  readonly candidate: Candidate;
  /** String literal types, maybe beside a receiver's opaque other keys (`keys`). */
  readonly keys: Type;
  /** Its key's member parameter, and what its other type parameters are on the receiver. */
  readonly key: TypeParameter;
  readonly substitution: Substitution;
}

/** The keyed indexes taking a receiver of type `receiver`, seen from `module`. */
export function keyedIndexes(
  checker: CheckerContext,
  module: ModuleId,
  receiver: Type,
): readonly KeyedIndex[] {
  const candidates = topLevelCandidates(checker, module, collectionFunctions.index, [receiver]);
  return candidates.flatMap((candidate) => keyedIndexOf(checker, candidate, receiver) ?? []);
}

/** The functions of `keyed`. */
export function candidatesOf(keyed: readonly KeyedIndex[]): readonly Candidate[] {
  return keyed.map(({ candidate }) => candidate);
}

/** Whether `keyed` takes `name` as a key. */
export function servesName(checker: CheckerContext, keyed: KeyedIndex, name: string): boolean {
  return isKeyWithin(checker, literalType(name), keyed.keys);
}

/** The names `keyed` takes, those its receiver's opaque keys may hold aside. */
export function keyNamesOf(keyed: KeyedIndex): readonly string[] {
  return membersOf(keyed.keys).flatMap((member) => keyName(member) ?? []);
}

/** What `keyed` gives read by the key `name`, each key its own instantiation (§3.5). */
export function keyedReadType(checker: CheckerContext, keyed: KeyedIndex, name: string): Type {
  const { result } = signatureOf(
    checker,
    keyed.candidate.declaration,
    keyed.candidate.requirement?.substitution,
  );
  const substitution = new Map([...keyed.substitution, [keyed.key, literalType(name)]]);
  return substitute(result(), substitution, checker.typeRules);
}

/**
 * `candidate` as a keyed index where its `self` takes a value of `receiver`, its constraints met;
 * undefined where it takes none so, or its key is no member parameter of String literals.
 */
function keyedIndexOf(
  checker: CheckerContext,
  candidate: Candidate,
  receiver: Type,
): KeyedIndex | undefined {
  const { parameters } = signatureOf(
    checker,
    candidate.declaration,
    candidate.requirement?.substitution,
  );
  const keyType = takesReceiverAndKey(parameters) ? parameters[1]?.type : undefined;
  const key =
    keyType?.kind === 'parameter' && keyType.declaration.kind === 'TypeParameter'
      ? keyType.declaration
      : undefined;
  const union = key && memberUnionOf(checker, key);
  const inference = union && metSelfInference(checker, candidate, receiver);
  if (key === undefined || union === undefined || inference === undefined) {
    return undefined;
  }
  const substitution = inference.substitution();
  const keys = substitute(union, substitution, checker.typeRules);
  return isStringKeys(keys) ? { candidate, keys, key, substitution } : undefined;
}

/**
 * Whether a read passing a receiver and a key, both by value, fills `parameters`, as `x["k"]` does:
 * neither taken by `&` nor collected by a rest, and every later parameter left to its default.
 */
function takesReceiverAndKey(parameters: readonly SignatureSlot[]): boolean {
  const [self, key, ...later] = parameters;
  const byValue = (slot: SignatureSlot) => !slot.reference && slot.rest === undefined;
  return (
    self !== undefined &&
    key !== undefined &&
    byValue(self) &&
    byValue(key) &&
    later.every((slot) => slot.hasDefault || slot.rest !== undefined)
  );
}

/**
 * Whether every member of `keys` is a String literal, or a receiver's opaque other keys; `Never`,
 * an empty struct's keys, is none (§3.1).
 */
function isStringKeys(keys: Type): boolean {
  return membersOf(keys).every(
    (member) =>
      keyName(member) !== undefined || member.kind === 'keys' || isPrimitive(member, 'Never'),
  );
}
