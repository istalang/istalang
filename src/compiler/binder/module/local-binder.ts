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
 * Every entity is made here, never while linking, once per node it stands for (../entities.ts): a
 * segment an edit left alike keeps the identity of everything it declares or refers to.
 *
 * Each category notes the scope it binds each node in (`enter`), so tools can tell afterwards which
 * names are visible where (visibility.ts).
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { type Convention, isUnnamed } from '../../../foundation/language/naming.ts';
import { memo, SequenceMemo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import {
  type FunctionDeclaration,
  isGenericDeclaration,
  type Module,
} from '../../syntax/declarations/index.ts';
import type {
  Comprehension,
  Expression,
  FieldHeader,
  Lambda,
  Parameter,
} from '../../syntax/expressions/index.ts';
import type { Annotatable } from '../../syntax/items.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { Block, For, VariableDeclaration } from '../../syntax/statements/index.ts';
import type { SyntaxNode, SyntaxTree } from '../../syntax/tree/index.ts';
import {
  type Identifier,
  type Invalid,
  isMissingName,
  type QualifiedName,
} from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { NamedType, TypeNode } from '../../syntax/types/index.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import {
  isAlias,
  ownCallEntity,
  qualifies,
  type VariableEntity,
  type VariableOwner,
  type VariantsEntity,
  variableEntity,
} from '../entities.ts';
import { namingViolation } from '../naming.ts';
import { functionsNamed, holdsOwnCall, noOwnCall } from './own-calls.ts';
import type { LocalEntity, Miss, Scope, ScopeSnapshot } from './scope.ts';
import { type Visibility, VisibilityNotes } from './visibility.ts';

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
  /**
   * For a value or a callee, what it denotes if some enum of the program has a variant by its
   * name: a variant is a value, and one with fields a function too (§3.11).
   */
  readonly variants: VariantsEntity | undefined;
}

/**
 * A qualified name whose head may be a module or an enum, and where it is written (`PathRole`). In
 * an expression, a part after an enum may also be a static function (`Color.default()`), which
 * only the checker can tell.
 */
export interface QualifiedPath {
  readonly parts: QualifiedName;
  readonly role: PathRole;
}

/**
 * Where a path is written, which says what may follow a part nothing qualifies: in an expression a
 * value's member, in a type an associated type (§3.1), naming a pattern's or literal's type
 * nothing.
 */
type PathRole = 'expression' | 'type' | 'named';

/** What binding one tree produced. */
export interface LocalResult {
  readonly entities: ReadonlyMap<Identifier, LocalEntity>;
  /**
   * The variable each async function holds its own call in, when its name before a `.` reads it.
   */
  readonly ownCalls: ReadonlyMap<FunctionDeclaration | Lambda, VariableEntity>;
  /**
   * Names before a `.` that only linking can tell name functions, imported or the prelude's, which
   * then denote no call (`useBeforeMember`).
   */
  readonly linkedHeads: readonly Identifier[];
  readonly free: readonly FreeName[];
  readonly paths: readonly QualifiedPath[];
  readonly diagnostics: readonly Diagnostic<AnchoredSpan>[];
  readonly visibility: Visibility;
  /**
   * What a bare name denotes when it may be any variant so named: one entity per name per module.
   */
  readonly variantsNamed: (name: string) => VariantsEntity;
  /** Every entity the tree's scopes defined. */
  readonly defined: ReadonlySet<LocalEntity>;
}

/** Per module, by its items, the entity of each bare name that may be any variant so named. */
const variantsByModule = new SequenceMemo<Module['items'][number], Map<string, VariantsEntity>>();

function isInvalid(node: SyntaxNode): node is Invalid {
  return node.kind === 'Invalid';
}

/** The handler of a kind whose nodes hold no names. */
export const holdsNoNames = (): void => undefined;

/**
 * The handler of an Invalid node standing where one node goes: it holds only the annotations the
 * parser rejected there, bound where it stands (§3.16).
 */
export const bindRejected = (binder: LocalBinder, node: Invalid, scope: Scope): void => {
  binder.annotations(node, scope);
};

/**
 * A declaration whose targets are patterns, owning every name they bind (§3.15): a parameter
 * owns its pattern's names (§3.3).
 */
type TargetOwner = VariableDeclaration | For | FieldHeader | Comprehension | Parameter;

/** Where a pattern's bindings go (../constructs/patterns.ts). */
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
  /**
   * Resolves the pattern's references in `scope` and defines its bindings where `bindings` says.
   */
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
  /** The tree being bound, which holds its functions' bodies. */
  readonly tree: SyntaxTree;
  readonly #entities = new Map<Identifier, LocalEntity>();
  readonly #free: FreeName[] = [];
  readonly #paths: QualifiedPath[] = [];
  readonly #diagnostics: Diagnostic<AnchoredSpan>[] = [];
  readonly #ownCalls = new Map<FunctionDeclaration | Lambda, VariableEntity>();
  readonly #linkedHeads: Identifier[] = [];
  readonly #notes = new VisibilityNotes();

  constructor(walk: Walk, tree: SyntaxTree) {
    this.walk = walk;
    this.tree = tree;
  }

  /** What binding the tree produced, `topLevel` being its module's scope once defined. */
  result(topLevel: ScopeSnapshot): LocalResult {
    return {
      entities: this.#entities,
      ownCalls: this.#ownCalls,
      linkedHeads: this.#linkedHeads,
      free: this.#free,
      paths: this.#paths,
      diagnostics: this.#diagnostics,
      visibility: this.#notes.visibility(topLevel),
      variantsNamed: (name) => this.#variantsNamed(name),
      defined: topLevel.scope.definedEntities(),
    };
  }

  /** Notes that `node`, from `from` on, is bound in `scope` as it is defined now. */
  enter(node: SyntaxNode, scope: Scope, from?: AnchoredSpan): void {
    this.#notes.note(node, scope, from);
  }

  /** Records what `name` denotes without defining it in a scope. */
  record(name: Identifier, entity: LocalEntity): void {
    this.#entities.set(name, entity);
  }

  report(diagnostic: Diagnostic<AnchoredSpan>): void {
    this.#diagnostics.push(diagnostic);
  }

  /** Resolves a use of `name`, or leaves it free for linking. */
  use(name: Identifier, scope: Scope, role: Role): void {
    if (isMissingName(name) || (isUnnamed(name.text) && role === 'assignment')) {
      return;
    }
    if (isUnnamed(name.text)) {
      this.report(binderDiagnostics.unnamedRead(name.span));
      return;
    }
    const entity = scope.lookup(name.text);
    if (entity === undefined) {
      const variants =
        role === 'value' || role === 'callee' ? this.#variantsNamed(name.text) : undefined;
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
    this.use(parts[0], scope, role);
    this.#qualifyLater(parts, scope, role === 'type' ? 'type' : 'named');
  }

  /** `a.b.c` in an expression, where a part after an enum may be a static function. */
  memberPath(parts: QualifiedName, scope: Scope): void {
    this.useBeforeMember(parts[0], scope);
    this.#qualifyLater(parts, scope, 'expression');
  }

  /**
   * Resolves `name` written before a `.`. A function's name has no members, so there it denotes the
   * call of the enclosing async function of that name (§7), held in a variable of that function.
   */
  useBeforeMember(name: Identifier, scope: Scope): void {
    const entity = scope.lookup(name.text);
    const functions = functionsNamed(entity);
    if (entity === undefined || functions === undefined) {
      this.use(name, scope, 'value');
      if (entity === undefined || entity.kind === 'import') {
        this.#linkedHeads.push(name);
      }
      return;
    }
    const enclosing = scope.enclosingOf(functions);
    if (enclosing !== undefined && !enclosing.fenced && holdsOwnCall(enclosing.function)) {
      this.record(name, this.#ownCallOf(enclosing.function));
    } else {
      this.report(noOwnCall(name, enclosing));
    }
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
    if (isUnnamed(name.text)) {
      return false;
    }
    const defined = scope.define(name.text, entity);
    if (!defined && clash !== false) {
      this.report(clash(name.span, name.text));
    }
    return defined;
  }

  /** Declares a camelCase variable whose declaring node is `owner`. */
  declareVariable(scope: Scope, name: Identifier, owner: VariableOwner): void {
    this.declare(scope, name, variableEntity(name, owner), { convention: 'value' });
  }

  /**
   * Binds the type a struct literal or pattern names. It may be a bare variant that only the
   * expected type identifies (`Ok{value: 42}`, which checking refuses, naming its call), so its
   * head is used as a value, not as a type.
   */
  constructedType(type: NamedType, scope: Scope): void {
    this.path(type.path, scope, 'value');
    for (const argument of type.typeArguments) {
      this.walk.type(this, argument, scope);
    }
  }

  /**
   * Binds the annotations on an item, each a struct value written in `scope` (§3.16): the scope
   * around it, or a generic declaration's own once its type parameters are defined, which they see
   * (constructs/declarations.ts).
   */
  annotations(item: Annotatable, scope: Scope): void {
    for (const annotation of item.annotations ?? []) {
      this.walk.expression(this, annotation.value, scope);
    }
  }

  /**
   * Walks a list's `items` in order: binds each one's annotations in `scope`, but a generic
   * declaration's, which its type parameters' scope binds (constructs/declarations.ts), then hands
   * it to `bind`, but an Invalid one, which holds only the annotations the parser rejected there,
   * still struct values written in `scope` that every tool walking the tree meets (§3.16).
   */
  eachItem<Item extends SyntaxNode & Annotatable>(
    items: readonly (Item | Invalid)[],
    scope: Scope,
    bind: (item: Item) => void,
  ): void {
    for (const item of items) {
      if (!isGenericDeclaration(item)) {
        this.annotations(item, scope);
      }
      if (!isInvalid(item)) {
        bind(item);
      }
    }
  }

  checkConvention(name: Identifier, convention: Convention): void {
    const violation = namingViolation(name, convention);
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

  /**
   * Leaves the later parts of `parts` for linking, when its head may qualify them, or outside an
   * expression, where linking reports a head that can't. A path still being written ends in a
   * missing name (`time.Duration.`): the parts before it are linked.
   */
  #qualifyLater(parts: QualifiedName, scope: Scope, role: PathRole): void {
    const written = withoutMissingLast(parts);
    const complete = !written.some(isMissingName);
    const linked = role !== 'expression' || mayQualify(scope.lookup(written[0].text));
    if (written.length > 1 && complete && linked) {
      this.#paths.push({ parts: written, role });
    }
  }

  #ownCallOf(node: FunctionDeclaration | Lambda): VariableEntity {
    return memo(this.#ownCalls, node, () =>
      ownCallEntity(
        node,
        node.name ?? unreachable('Only a named function has a call its name reads.'),
      ),
    );
  }

  /**
   * One entity per bare name per module, kept while the module's items are, so an edit inside a
   * body keeps it (../entities.ts).
   */
  #variantsNamed(name: string): VariantsEntity {
    const ofModule = variantsByModule.get(this.tree.root.items, () => new Map());
    return memo(ofModule, name, () => ({ kind: 'variants', name }));
  }
}

/** How a declared name is checked: its case, and how a name already defined is reported. */
interface DeclarationRules {
  readonly convention?: Convention;
  /**
   * Makes the diagnostic for a name the scope already defines; a plain duplicate by default, and
   * none when `false`, for a name whose repeat its declaration reported already.
   */
  readonly clash?: ((span: AnchoredSpan, name: string) => Diagnostic<AnchoredSpan>) | false;
}

/**
 * Whether a name's later parts can be resolved by name: through a module or an enum, or through
 * whatever a name declared nowhere here, or an alias, turns out to be once linked.
 */
function mayQualify(head: LocalEntity | undefined): boolean {
  return head === undefined || head.kind === 'import' || qualifies(head) || isAlias(head);
}

/** `parts` without the missing name a path still being written ends in. */
function withoutMissingLast(parts: QualifiedName): QualifiedName {
  const [head, ...rest] = parts;
  const last = rest.at(-1);
  return last !== undefined && isMissingName(last) ? [head, ...rest.slice(0, -1)] : parts;
}
