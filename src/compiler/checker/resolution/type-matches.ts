/**
 * Reducing a use of a type `match` (§3.17): the type of the first case matching its subject.
 *
 * - A union subject distributes: each member is matched on its own, the subject's parameter
 *   standing for it inside the case, and the cases' types join into a union; `Never`, no member,
 *   gives `Never`. A tuple is no union, so `match (D,):` matches a union whole.
 * - A use whose arguments hold types not known yet reduces only when its first case that could
 *   match matches whatever they become (type-match-patterns.ts): a subject that may itself become
 *   a union, a type parameter or a type computed from one, decides nothing, since it would
 *   distribute, and `Never`, no member, would give `Never` whatever the cases. Otherwise the use stays unreduced, opaque, and an instantiation reduces it.
 * - A use matching no case is the error type, carrying the use: the check of the instantiation
 *   reaching it reports it there (match-requirements.ts), so nothing else reports it again.
 * - An alias reducing to itself with a type built from its own parameter never ends (§3.5); its
 *   declaration reports it (declarations/type-match-expansion.ts), and its uses are the error type.
 * - Each reduction is an entry of the checker's, by the use's type key. One reaching a use whose
 *   reduction is under way repeats it: a recursive type, which a struct holds (§3.1). The uses on
 *   that cycle whose case gives a struct type stand for themselves (`RecursiveType`), their shape
 *   derived on demand with each such use inside it, as a recursive struct's fields refer to it.
 *   Which uses those are doesn't depend on where reducing started: before a use is first reduced,
 *   reducing it once without keeping anything finds them, so no kept reduction holds a stand-in.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { AliasDeclaration } from '../../syntax/declarations.ts';
import { type StructType, unparenthesizedType } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { isOpaque, type RecursiveType } from '../types/computed-types.ts';
import { substituteStructConstraint } from '../types/struct-constraint.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import {
  type AnonymousStructType,
  errorType,
  isPrimitive,
  neverType,
  type Type,
} from '../types/type.ts';
import { typeKeys } from '../types/type-keys.ts';
import {
  type CaseForm,
  type CasePatternForm,
  matchUse,
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

export class TypeMatchReductions {
  readonly #checker: CheckerContext;
  readonly #reductions: EntryTable<CheckerNote, string, Type, MatchUse>;
  readonly #shapes: EntryTable<CheckerNote, string, AnonymousStructType, MatchUse>;
  /** The uses whose reductions are under way, in order, by type key: each removed once done. */
  readonly #reducing = new Map<string, MatchUse>();
  /** The uses found to stand for themselves (the banner), and the struct type each case writes. */
  readonly #recursive = new Map<string, StructType | undefined>();
  /** The uses reduced once already, or found while one was: they need no finding again. */
  readonly #found = new Set<string>();
  /** The use being reduced to find recursive uses, keeping nothing (`#find`); none otherwise. */
  readonly #finding = new Set<string>();

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#reductions = checker.entries.table({
      name: 'type match reductions',
      compute: (_key, use: MatchUse) => this.#reduced(use),
    });
    this.#shapes = checker.entries.table({
      name: 'recursive type match shapes',
      compute: (key, use: MatchUse) => this.#shapeOf(key, use),
    });
  }

  /** The shape the recursive use `type` stands for (the banner). */
  recursiveShape(type: RecursiveType): AnonymousStructType {
    const use = { declaration: type.declaration, typeArguments: type.arguments };
    return this.#shapes.get(typeKeys.typeKey(type), use);
  }

  #shapeOf(key: string, use: MatchUse): AnonymousStructType {
    const body = this.#reduced(use);
    const recursion = { declaration: use.declaration, arguments: use.typeArguments };
    if (body.kind === 'anonymous') {
      return { ...body, recursion };
    }
    const origin = this.#recursive.get(key) ?? unreachable('A recursive use gives a struct type.');
    return { kind: 'anonymous', origin, fields: [], recursion };
  }

  /** The use of `declaration` with `typeArguments`, reduced as far as they allow (the banner). */
  reduce(declaration: AliasDeclaration, typeArguments: readonly Type[]): Type {
    const failed = typeArguments.map(errorIn).find((each) => each !== undefined);
    if (failed !== undefined) {
      return failed;
    }
    const use = { declaration, typeArguments };
    const key = typeKeys.typeKey(matchUse(declaration, typeArguments));
    if (this.#reducing.has(key)) {
      return this.#reachedAgain(key, use);
    }
    if (this.#reducing.size >= deepestReduction) {
      return errorType;
    }
    if (this.#finding.size === 0 && !this.#found.has(key)) {
      this.#find(key, use);
    }
    if (this.#recursive.has(key)) {
      return recursiveUse(use);
    }
    return this.#reducingWith(key, use, () =>
      this.#finding.size > 0 ? this.#reduced(use) : this.#reductions.get(key, use),
    );
  }

  /** What `reduce` gives, with `use` under way meanwhile. */
  #reducingWith(key: string, use: MatchUse, reduce: () => Type): Type {
    this.#found.add(key);
    this.#reducing.set(key, use);
    try {
      return reduce();
    } finally {
      this.#reducing.delete(key);
    }
  }

  /** Reduces `use` once, keeping nothing, to find the uses that stand for themselves (the banner). */
  #find(key: string, use: MatchUse): void {
    this.#finding.add(key);
    try {
      this.#reducingWith(key, use, () => this.#reduced(use));
    } finally {
      this.#finding.delete(key);
    }
  }

  /**
   * A use reached while its own reduction is under way: each use on that cycle whose case writes a
   * struct type stands for itself from now on; this one too, or else a stand-in only finding
   * reaches, which it drops.
   */
  #reachedAgain(key: string, use: MatchUse): Type {
    const cycle = [...this.#reducing].slice([...this.#reducing.keys()].indexOf(key));
    for (const [each, eachUse] of cycle) {
      const origin = this.#structCaseOf(eachUse);
      if (origin !== undefined) {
        this.#recursive.set(each, origin);
      }
    }
    return this.#recursive.has(key) ? recursiveUse(use) : errorType;
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
        return matchUse(declaration, typeArguments);
      }
      reduced.push(
        each === 'unmatched'
          ? { kind: 'error', unmatched: { declaration, arguments: typeArguments } }
          : each,
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

/** The use `use` standing for itself (`RecursiveType`). */
function recursiveUse({ declaration, typeArguments }: MatchUse): RecursiveType {
  return { kind: 'recursive', declaration, arguments: typeArguments };
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
