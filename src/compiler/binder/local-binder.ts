/**
 * The context every local binding function receives: what has been resolved so far, what is left
 * for linking, and the entry point of each syntax category.
 *
 * Categories (declarations, statements, expressions, patterns, types) call one another in cycles:
 * a lambda holds a block, a block holds patterns, a pattern compares a field against an
 * expression. So a category reaches another only through `walk`, which bind-module.ts wires once,
 * the same arrangement as the parser's grammar.
 *
 * Local binding sees one tree. A name it can't find there is either declared in the prelude, a
 * variant chosen by its expected type, or undeclared, and only the whole program can tell, so it
 * goes to `free` with the reason a scope gave for missing it. A qualified name (`m.Pair`,
 * `Decision.Expired`) goes to `paths` whole: its later parts are resolved once its head is.
 *
 * Every entity is made here, per tree, never while linking: an unchanged module keeps the
 * identity of everything it declares or refers to across Program snapshots.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { memo } from '../../structures/memo.ts';
import type { Span } from '../../text/span.ts';
import type { Annotatable } from '../syntax/annotations.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Comprehension, Expression, Lambda } from '../syntax/expressions.ts';
import { type Identifier, isMissingName, type QualifiedName } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { Block, For, VariableDeclaration } from '../syntax/statements.ts';
import type { NamedType, TypeNode } from '../syntax/types.ts';
import { binderDiagnostics } from './diagnostics.ts';
import type { VariableOwner, VariantsEntity } from './entities.ts';
import { type Convention, conventionViolation } from './naming.ts';
import type { LocalEntity, Miss, Scope } from './scope.ts';

/**
 * How a name is used: read as a value, named as a type, assigned to, or called. A called name that
 * no scope defines may still name functions argument-dependent lookup finds (§3.13), which only the
 * checker can tell, so it is no diagnostic here.
 */
export type Role = 'value' | 'type' | 'assignment' | 'callee';

/** A name no scope of its tree defines, resolved when the program is linked. */
export interface FreeName {
  readonly name: Identifier;
  readonly role: Role;
  readonly miss: Miss | undefined;
  /** For a value, what it denotes if some enum of the program has a variant by its name. */
  readonly variants: VariantsEntity | undefined;
}

/**
 * A qualified name whose head may be a module or an enum. In an expression, a part after an enum
 * may also be a static function (`Color.default()`), which only the checker can tell.
 */
export interface QualifiedPath {
  readonly parts: QualifiedName;
  readonly inExpression: boolean;
}

/** What binding one tree produced. */
export interface LocalResult {
  readonly entities: ReadonlyMap<Identifier, LocalEntity>;
  readonly free: readonly FreeName[];
  readonly paths: readonly QualifiedPath[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The handler of a kind whose nodes hold no names. */
export const holdsNoNames = (): void => undefined;

/** A declaration whose targets are patterns, owning every name they bind (§3.15). */
export type TargetOwner = VariableDeclaration | For | Comprehension;

/** Where a pattern's bindings go (patterns.ts). */
export interface PatternBindings {
  /**
   * The scope bindings are defined in; undefined when they were defined already, as a top-level
   * constant's names are, with the module's own (module-scope.ts).
   */
  readonly into: Scope | undefined;
  /** The declaration the pattern is a target of; undefined for a `match` case or `is`. */
  readonly declaration?: TargetOwner;
}

/** The entry point of each syntax category, wired in by bind-module.ts. */
export interface Walk {
  readonly expression: (binder: LocalBinder, node: Expression, scope: Scope) => void;
  readonly block: (binder: LocalBinder, node: Block, scope: Scope) => void;
  /** Resolves the pattern's references in `scope` and defines its bindings where `bindings` says. */
  readonly pattern: (
    binder: LocalBinder,
    node: Pattern,
    scope: Scope,
    bindings: PatternBindings,
  ) => void;
  readonly type: (binder: LocalBinder, node: TypeNode, scope: Scope) => void;
  readonly function: (
    binder: LocalBinder,
    node: FunctionDeclaration | Lambda,
    scope: Scope,
  ) => void;
}

export class LocalBinder {
  readonly walk: Walk;
  readonly #entities = new Map<Identifier, LocalEntity>();
  readonly #free: FreeName[] = [];
  readonly #paths: QualifiedPath[] = [];
  readonly #diagnostics: Diagnostic[] = [];
  readonly #variants = new Map<string, VariantsEntity>();

  constructor(walk: Walk) {
    this.walk = walk;
  }

  result(): LocalResult {
    return {
      entities: this.#entities,
      free: this.#free,
      paths: this.#paths,
      diagnostics: this.#diagnostics,
    };
  }

  /** Records what `name` denotes without defining it in a scope. */
  record(name: Identifier, entity: LocalEntity): void {
    this.#entities.set(name, entity);
  }

  report(diagnostic: Diagnostic): void {
    this.#diagnostics.push(diagnostic);
  }

  /** Resolves a use of `name`, or leaves it free for linking. */
  use(name: Identifier, scope: Scope, role: Role): void {
    if (isMissingName(name) || (name.text === '_' && role === 'assignment')) {
      return;
    }
    if (name.text === '_') {
      this.report(binderDiagnostics.unnamedRead(name.span));
      return;
    }
    const entity = scope.lookup(name.text);
    if (entity === undefined) {
      const variants = role === 'value' ? this.#variantsNamed(name.text) : undefined;
      this.#free.push({ name, role, miss: scope.explainMiss(name.text), variants });
    } else {
      this.record(name, entity);
    }
  }

  /**
   * Resolves a possibly qualified name: its head now, its other parts once linked. Parts after a
   * head that can't qualify (a variable, a struct) are members, which the checker resolves.
   */
  path(parts: QualifiedName, scope: Scope, role: Role): void {
    this.#qualify(parts, scope, role, false);
  }

  /** `a.b.c` in an expression, where a part after an enum may be a static function. */
  memberPath(parts: QualifiedName, scope: Scope): void {
    this.#qualify(parts, scope, 'value', true);
  }

  /**
   * Declares `name` as `entity` in `scope`; false when the name defines nothing. `_` is recorded
   * but never defined, so it can't be read.
   */
  declare(
    scope: Scope,
    name: Identifier,
    entity: LocalEntity,
    { convention, clash = binderDiagnostics.duplicateDeclaration }: DeclarationRules = {},
  ): boolean {
    if (isMissingName(name)) {
      return false;
    }
    this.record(name, entity);
    if (convention !== undefined) {
      this.checkConvention(name, convention);
    }
    if (name.text === '_') {
      return false;
    }
    const defined = scope.define(name.text, entity);
    if (!defined) {
      this.report(clash(name.span, name.text));
    }
    return defined;
  }

  /** Declares a camelCase variable whose declaring node is `owner`. */
  declareVariable(scope: Scope, name: Identifier, owner: VariableOwner): void {
    this.declare(scope, name, { kind: 'variable', name, owner }, { convention: 'value' });
  }

  /**
   * Binds the type a struct literal or pattern names. It may be a bare variant that only the
   * expected type identifies (`Ok{42}`), so its head is used as a value, not as a type.
   */
  constructedType(type: NamedType, scope: Scope): void {
    this.path(type.path, scope, 'value');
    for (const argument of type.typeArguments) {
      this.walk.type(this, argument, scope);
    }
  }

  /** Binds the annotations on an item; each is a struct value written in the item's scope (§3.16). */
  annotations(item: Annotatable, scope: Scope): void {
    for (const annotation of item.annotations ?? []) {
      this.walk.expression(this, annotation.value, scope);
    }
  }

  checkConvention(name: Identifier, convention: Convention): void {
    const violation = conventionViolation(name, convention);
    if (violation !== undefined) {
      this.report(violation);
    }
  }

  /** Checks names that live in their own namespace, such as fields: convention, no repeats. */
  checkMemberNames(names: readonly Identifier[], convention: Convention): void {
    const seen = new Set<string>();
    for (const name of names) {
      this.checkConvention(name, convention);
      if (seen.has(name.text)) {
        this.report(binderDiagnostics.duplicateDeclaration(name.span, name.text));
      }
      if (!isMissingName(name)) {
        seen.add(name.text);
      }
    }
  }

  #qualify(parts: QualifiedName, scope: Scope, role: Role, inExpression: boolean): void {
    this.use(parts[0], scope, role);
    const complete = !parts.some(isMissingName);
    if (parts.length > 1 && complete && mayQualify(this.#entities.get(parts[0]))) {
      this.#paths.push({ parts, inExpression });
    }
  }

  /** One entity per bare name per tree, so it survives every snapshot that keeps the tree. */
  #variantsNamed(name: string): VariantsEntity {
    return memo(this.#variants, name, () => ({ kind: 'variants', name }));
  }
}

/** How a declared name is checked: its case, and how a name already defined is reported. */
interface DeclarationRules {
  readonly convention?: Convention;
  /** Makes the diagnostic for a name the scope already defines; a plain duplicate by default. */
  readonly clash?: (span: Span, name: string) => Diagnostic;
}

/** Whether a name's later parts can be resolved by name: through a module or an enum. */
function mayQualify(head: LocalEntity | undefined): boolean {
  switch (head?.kind) {
    case undefined:
    case 'import':
    case 'namespace':
      return true;
    case 'type':
      return head.declaration.kind === 'EnumDeclaration';
    default:
      return false;
  }
}
