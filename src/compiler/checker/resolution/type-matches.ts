/**
 * Reducing a use of a type `match` (§3.17): the type of the first case matching its subject.
 *
 * - A union subject distributes: each member is matched on its own, the subject's parameter
 *   standing for it inside the case, and the cases' types join into a union; `Never`, no member,
 *   gives `Never`. A tuple is no union, so `match (D,):` matches a union whole.
 * - A use whose arguments hold types not known yet reduces only when its first case that could
 *   match matches whatever they become (type-match-patterns.ts): a subject that may itself become
 *   a union, a type parameter or a type computed from one, decides nothing, since it would
 *   distribute, and `Never`, no member, would give `Never` whatever the cases. Otherwise the use
 *   stays unreduced, opaque, and an instantiation reduces it.
 * - A use matching no case is the error type, carrying the use: the check of the instantiation
 *   reaching it reports it there (reduction-requirements.ts), so nothing else reports it again. So
 *   is one whose reduction reaches the use itself with no struct type holding it on the way
 *   (`case _: A<T>`, `case _: A<T> | Int`): it would be itself, as an alias can't be (§3.17).
 * - An alias reducing to itself with a type built from its own parameter never ends (§3.5); its
 *   declaration reports it (rules/expansion/type-matches.ts), and its uses are the error type.
 * - Each reduction is an entry of the checker's, by the use's spelled key (type-keys.ts): what it
 *   gives is spelled with the use's own arguments, so another spelling of the same type is another
 *   entry, and no use is answered with a type spelled at another's nodes. Which uses are under way
 *   or recursive is a matter of type identity, so those are kept by type key. One reaching a use whose
 *   reduction is under way repeats it: a recursive type, which a struct holds (§3.1). The uses on
 *   that cycle whose case gives a struct type are recursive: each closes, with every recursive use
 *   its finding reached, through the one constructor of recursive types (types/recursive-types.ts),
 *   their bodies reduced with each such use an unreduced placeholder, so a recursive type `match` use
 *   and a recursive alias with its structure are one type (§3.17). One whose values would hold
 *   themselves names no type: the error type, carrying why (types/finiteness.ts).
 * - Whether a use is recursive, or would be itself with no struct type on its cycle, is an entry
 *   too, found before it is reduced by reducing it once in a scope of its own and keeping nothing
 *   but those verdicts (`#recursionOf`): it depends on the use alone, never on what was reduced
 *   before it, so each use on such a cycle is recursive whichever was asked first, and every
 *   reduction reading it records that, so a later revision takes over no verdict its program no
 *   longer gives. What is under way is the only state beside the entries, and it lasts as long as
 *   the reduction it describes; a reduction inside a finding or a closing is kept by neither, since
 *   it holds their placeholders.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { withPushed } from '../../../structures/stack.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { AliasDeclaration } from '../../syntax/declarations.ts';
import { type StructType, unparenthesizedType } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { isOpaque, type MatchType, unfoldRecursive } from '../types/computed-types.ts';
import { fieldReaderOf, selfHoldingField } from '../types/finiteness.ts';
import { closeRecursive } from '../types/recursive-types.ts';
import { substituteStructConstraint } from '../types/struct-constraint.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import { errorType, isPrimitive, neverType, type Type } from '../types/type.ts';
import { typeKeys } from '../types/type-keys.ts';
import {
  type CaseForm,
  type CasePatternForm,
  labelOf,
  rebuilt,
  type TypeMatchForm,
} from '../types/type-match.ts';
import { errorIn } from '../types/type-parts.ts';
import { unionOf } from '../types/unions.ts';
import { matchCase } from './type-match-patterns.ts';

/** A use of a type `match` alias, by its declaration and arguments. */
interface MatchUse {
  readonly declaration: AliasDeclaration;
  readonly typeArguments: readonly Type[];
}

/** What reducing one member of a subject found: its type, or why there is none yet. */
type MemberReduction = Type | 'undecided' | 'unmatched';

/** How deep reductions may nest before one is taken as endless, which declarations report. */
const deepestReduction = 256;

/**
 * What reducing a use found of one reached again while its reduction was under way (the banner):
 * `use` is recursive, its case writing `origin`; or no struct type holds it on its way back, so it
 * would be itself, no type.
 */
type RecursionVerdict =
  | { readonly kind: 'recursive'; readonly origin: StructType; readonly use: MatchUse }
  | { readonly kind: 'itself' };

/** The verdicts finding a use's recursion reached, by type key. */
type Recursion = ReadonlyMap<string, RecursionVerdict>;

/**
 * Reductions under way: the uses being reduced, in order, by type key; while finding which uses are
 * recursive, what was found so far, kept nowhere else (`#recursionOf`); and while closing recursive
 * uses, the index of each among the bodies closing (`#closed`).
 */
interface Reducing {
  readonly underWay: Map<string, MatchUse>;
  readonly found?: Map<string, RecursionVerdict> | undefined;
  readonly closing?: ReadonlyMap<string, number> | undefined;
}

export class TypeMatchReductions {
  readonly #checker: CheckerContext;
  readonly #reductions: EntryTable<CheckerNote, string, Type, MatchUse>;
  readonly #closings: EntryTable<CheckerNote, string, Type, MatchUse>;
  readonly #recursion: EntryTable<CheckerNote, string, Recursion, MatchUse>;
  /** The reductions under way, innermost last: a finding or a closing reduces in a scope of its own. */
  readonly #scopes: Reducing[] = [{ underWay: new Map() }];

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#reductions = checker.entries.table({
      name: 'type match reductions',
      compute: (_key, use: MatchUse) => this.#reduced(use),
    });
    this.#closings = checker.entries.table({
      name: 'recursive type match closings',
      compute: (_key, use: MatchUse) => this.#closed(use),
    });
    this.#recursion = checker.entries.table({
      name: 'type match recursion',
      compute: (key, use: MatchUse) => this.#recursionOf(key, use),
      equal: sameRecursion,
    });
  }

  /** The unreduced use of `declaration` with `typeArguments` (types/type-match.ts `matchUse`). */
  #useOf(declaration: AliasDeclaration, typeArguments: readonly Type[]): MatchType {
    return this.#checker.typeMatches.useOf(declaration, typeArguments);
  }

  /** The use of `declaration` with `typeArguments`, reduced as far as they allow (the banner). */
  reduce(declaration: AliasDeclaration, typeArguments: readonly Type[]): Type {
    const failed = typeArguments.map(errorIn).find((each) => each !== undefined);
    if (failed !== undefined) {
      return failed;
    }
    const use = { declaration, typeArguments };
    const key = typeKeys.typeKey(this.#useOf(declaration, typeArguments));
    const scope = this.#scope();
    if (scope.closing?.has(key) === true) {
      return this.#useOf(declaration, typeArguments);
    }
    if (scope.underWay.has(key)) {
      return this.#reachedAgain(scope, key, use);
    }
    if (scope.underWay.size >= deepestReduction) {
      return errorType;
    }
    const { found } = scope;
    const verdict = (found ?? this.#recursion.get(key, use)).get(key);
    const kept = scope === this.#scopes[0];
    if (verdict?.kind === 'itself') {
      return unreducedUse(use, 'itself');
    }
    if (verdict !== undefined) {
      // Finding verdicts needs none of the types a recursive use closes to.
      if (found !== undefined) {
        return this.#useOf(declaration, typeArguments);
      }
      const spelled = typeKeys.spelledKey(this.#useOf(declaration, typeArguments));
      return kept ? this.#closings.get(spelled, use) : this.#closed(use);
    }
    const spelled = typeKeys.spelledKey(this.#useOf(declaration, typeArguments));
    return reducingWith(scope, key, use, () =>
      kept ? this.#reductions.get(spelled, use) : this.#reduced(use),
    );
  }

  /**
   * The type the recursive `use` closes to (the banner): every recursive use its finding reached
   * closes with it, each body reduced in a scope where reaching one of them gives its unreduced use,
   * the placeholder closing replaces; the error type, carrying why, for one whose values would hold
   * themselves.
   */
  #closed(use: MatchUse): Type {
    const key = typeKeys.typeKey(this.#useOf(use.declaration, use.typeArguments));
    const group = [...this.#recursion.get(key, use)].flatMap(([each, verdict]) =>
      verdict.kind === 'recursive' ? [[each, verdict.use] as const] : [],
    );
    const closing = new Map(group.map(([each], index) => [each, index] as const));
    const scope: Reducing = { underWay: new Map(), closing };
    const bodies = withPushed(this.#scopes, scope, () =>
      group.map(([each, eachUse]) =>
        reducingWith(scope, each, eachUse, () => this.#reduced(eachUse)),
      ),
    );
    const closed = closeRecursive({
      bodies,
      placeholderOf: (type) =>
        type.kind === 'match' ? closing.get(typeKeys.typeKey(type)) : undefined,
      labels: group.map(([, { declaration, typeArguments }]) =>
        labelOf(this.#useOf(declaration, typeArguments)),
      ),
      rules: this.#checker.typeRules,
    })[closing.get(key) ?? -1];
    if (closed === undefined) {
      return unreachable('A recursive use closed to nothing.');
    }
    if (closed.kind !== 'recursive') {
      return closed;
    }
    const body = unfoldRecursive(closed);
    const fields = body.kind === 'anonymous' ? body.fields : [];
    const holding = selfHoldingField(fieldReaderOf(this.#checker), fields, closed);
    return holding === undefined ? closed : holdingItself(use, holding.name);
  }

  /** The reductions under way now. */
  /** Whether no reduction is under way, so a use reduces as it would asked on its own. */
  isIdle(): boolean {
    const [outermost, ...inner] = this.#scopes;
    return inner.length === 0 && outermost?.underWay.size === 0;
  }

  #scope(): Reducing {
    return this.#scopes.at(-1) ?? unreachable('No scope holds the reductions under way.');
  }

  /**
   * Which uses stand for themselves (the banner), found by reducing `use` once in a scope of its
   * own, keeping nothing else.
   */
  #recursionOf(key: string, use: MatchUse): Recursion {
    const found = new Map<string, RecursionVerdict>();
    const scope: Reducing = { underWay: new Map(), found };
    withPushed(this.#scopes, scope, () => reducingWith(scope, key, use, () => this.#reduced(use)));
    return found;
  }

  /**
   * A use reached while its own reduction is under way, which only finding a use's recursion meets
   * (normal reductions read each use's verdict first, so they never come back to one): each use on
   * that cycle whose case writes a struct type is recursive from now on; when none does, no struct
   * type holds any of them on its way back, so each would be itself, no type (§3.17). Each verdict
   * depends on its use alone, so whichever use was entered first, every one is found alike.
   */
  #reachedAgain(scope: Reducing, key: string, use: MatchUse): Type {
    const { underWay, found } = scope;
    if (found === undefined) {
      return unreachable('A reduction came back to a use whose verdict said it never would.');
    }
    const cycle = [...underWay].slice([...underWay.keys()].indexOf(key));
    const origins = cycle.map(
      ([each, eachUse]) => [each, eachUse, this.#structCaseOf(eachUse)] as const,
    );
    const guarded = origins.some(([, , origin]) => origin !== undefined);
    for (const [each, eachUse, origin] of origins) {
      if (origin !== undefined) {
        found.set(each, { kind: 'recursive', origin, use: eachUse });
      } else if (!guarded) {
        found.set(each, { kind: 'itself' });
      }
    }
    return found.get(key)?.kind === 'recursive'
      ? this.#useOf(use.declaration, use.typeArguments)
      : unreducedUse(use, 'itself');
  }

  /** The struct type the case `use` picks writes, when it writes one and no union distributes. */
  #structCaseOf({ declaration, typeArguments }: MatchUse): StructType | undefined {
    const checker = this.#checker;
    const form = checker.typeMatches.typeMatchOf(declaration);
    if (form === undefined) {
      return undefined;
    }
    const substitution = substitutionFor(form.parameters, typeArguments);
    const subject = instantiated(checker, form.subject, substitution);
    const picked = form.cases.find(
      (each) =>
        matchCase(
          checker,
          instantiatedPattern(checker, each, substitution),
          each.variables,
          subject,
        ).outcome === 'match',
    );
    const written = picked === undefined ? undefined : unparenthesizedType(picked.node.type);
    return subject.kind !== 'union' && written?.kind === 'StructType' ? written : undefined;
  }

  #reduced({ declaration, typeArguments }: MatchUse): Type {
    const checker = this.#checker;
    const form = checker.typeMatches.typeMatchOf(declaration);
    if (form === undefined) {
      return errorType;
    }
    const substitution = substitutionFor(form.parameters, typeArguments);
    const subject = instantiated(checker, form.subject, substitution);
    if (subject.kind === 'error') {
      return errorType;
    }
    if (isPrimitive(subject, 'Never')) {
      return neverType;
    }
    const members = subject.kind === 'union' ? subject.members : [subject];
    const reduced: Type[] = [];
    for (const member of members) {
      const each = this.#memberReduced(declaration, form, substitution, member);
      if (each === 'undecided') {
        return this.#useOf(declaration, typeArguments);
      }
      reduced.push(
        each === 'unmatched' ? unreducedUse({ declaration, typeArguments }, 'unmatched') : each,
      );
    }
    return unionOf(reduced, checker.typeRules);
  }

  /** The type the first case matching `member` gives, or why there is none (the banner). */
  #memberReduced(
    declaration: AliasDeclaration,
    form: TypeMatchForm,
    substitution: Substitution,
    member: Type,
  ): MemberReduction {
    const checker = this.#checker;
    if (isOpaque(member) && mayBecomeUnion(checker, member)) {
      return 'undecided';
    }
    if (checker.typeMatches.isEndless(declaration)) {
      return errorType;
    }
    const inCase = new Map(substitution);
    if (form.subjectParameter !== undefined) {
      inCase.set(form.subjectParameter, member);
    }
    for (const each of form.cases) {
      const { outcome, bound } = matchCase(
        checker,
        instantiatedPattern(checker, each, substitution),
        each.variables,
        member,
      );
      if (outcome === 'undecided') {
        return 'undecided';
      }
      if (outcome === 'match') {
        const caseType = checker.typeMatches.caseTypeOf(declaration, each.node);
        return instantiated(checker, caseType, new Map([...inCase, ...bound]));
      }
    }
    return 'unmatched';
  }
}

/** What `reduce` gives, with `use` under way in `scope` meanwhile. */
function reducingWith(scope: Reducing, key: string, use: MatchUse, reduce: () => Type): Type {
  scope.underWay.set(key, use);
  try {
    return reduce();
  } finally {
    scope.underWay.delete(key);
  }
}

/** Whether two findings reached the same uses with the same verdicts, each writing one struct type. */
function sameRecursion(first: Recursion, second: Recursion): boolean {
  return (
    first.size === second.size &&
    [...first].every(([key, verdict]) => {
      const other = second.get(key);
      return (
        other?.kind === verdict.kind &&
        (verdict.kind === 'itself' ||
          (other.kind === 'recursive' && other.origin === verdict.origin))
      );
    })
  );
}

/** The error type carrying `use`, which names no type for `cause`. */
function unreducedUse(
  { declaration, typeArguments }: MatchUse,
  cause: 'unmatched' | 'itself',
): Type {
  return { kind: 'error', unreduced: { use: { declaration, arguments: typeArguments }, cause } };
}

/** The error type carrying the recursive `use`, whose values would hold themselves through `field`. */
function holdingItself({ declaration, typeArguments }: MatchUse, field: string): Type {
  const use = { declaration, arguments: typeArguments };
  return { kind: 'error', unreduced: { use, cause: 'holdsItself', field } };
}

/** A case's pattern with its declaration's parameters given their arguments. */
function instantiatedPattern(
  checker: CheckerContext,
  { pattern }: CaseForm,
  substitution: Substitution,
): CasePatternForm {
  switch (pattern.kind) {
    case 'any':
      return pattern;
    case 'struct':
      return {
        kind: 'struct',
        constraint: substituteStructConstraint(pattern.constraint, substitution, checker.typeRules),
      };
    case 'type':
      return { kind: 'type', type: instantiated(checker, pattern.type, substitution) };
    default: {
      const unhandled: never = pattern;
      return unhandled;
    }
  }
}

/**
 * `type` with `substitution` applied, every use of a type `match` in it reduced as far as it
 * allows: a case's type and patterns resolve with the uses in them unreduced (type-match.ts).
 */
function instantiated(checker: CheckerContext, type: Type, substitution: Substitution): Type {
  const rules = checker.typeRules;
  return substitution.size === 0 ? rebuilt(type, rules) : substitute(type, substitution, rules);
}

/**
 * Whether `type`, not known yet, may become a union, which would distribute (§3.17): any type
 * parameter or computed type may, but one member of a union (`K in U`, a mapped key), and a type
 * a struct constraint makes a struct.
 */
function mayBecomeUnion(checker: CheckerContext, type: Type): boolean {
  if (type.kind === 'mapped') {
    return false;
  }
  if (type.kind !== 'parameter') {
    return true;
  }
  const { declaration } = type;
  if (type.within !== undefined || declaration.kind !== 'TypeParameter') {
    return type.within === undefined;
  }
  return (
    !declaration.isPack &&
    declaration.memberOf === undefined &&
    checker.structConstraintsOf(declaration).length === 0
  );
}
