/**
 * What an editor shows for the spot under a pointer: for a name, what it denotes there, each
 * declaration as a line of code with its type, and the docstring of what it names; for any other
 * expression or written type, its type. A type written through a spelling, an alias, an associated
 * type or a struct's keys, shows what it names beside it (`writtenAndNamedText`); one known only by
 * its bounds, an opaque type, shows them: `T.Data is Encodable` (`shownText`).
 *
 * A name is answered through the identifier query (checker denotation.ts), as going to its
 * definition is, so the two never disagree; a String literal naming a field as its key (§3.1),
 * through the key query, as the field it names. A shorthand, `Pair{first}`, names a field and a
 * variable, and shows both. A function shows its signature, which spells its type with its
 * parameters' names.
 */

import type { Checker } from '../compiler/checker/check.ts';
import type { Denotation } from '../compiler/checker/surface/denotation.ts';
import { isOpaque } from '../compiler/checker/types/type/computed-types.ts';
import type { Type } from '../compiler/checker/types/type/index.ts';
import { constraintText, writtenAndNamedText } from '../compiler/checker/types/type/type-text.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import type { Expression } from '../compiler/syntax/expressions/index.ts';
import type { StringLiteral } from '../compiler/syntax/expressions/literals/literals.ts';
import { nodesAt, type SyntaxNode } from '../compiler/syntax/tree/index.ts';
import type { Identifier } from '../compiler/syntax/tree/node.ts';
import { spanIn } from '../compiler/syntax/tree/positions.ts';
import type { TypeNode } from '../compiler/syntax/types/index.ts';
import type { Span } from '../text/span.ts';
import { type CheckedModule, checkedModule } from './checked-module.ts';
import { docstringOf } from './docstrings.ts';
import { identifierAt } from './identifier-at.ts';
import { importedModule } from './namespaces.ts';
import { signatureOf } from './signatures/signatures.ts';

export interface Hover {
  /** The name or expression hovered over. */
  readonly span: Span;
  /** Each declaration the name denotes, or the expression's type, as a line of code. */
  readonly code: readonly string[];
  readonly doc: string | undefined;
}

/**
 * What hovering at `offset` of `module` shows: the innermost node holding it that has a name or a
 * type, so a construct's own keywords and punctuation (`if`, `else`, a block's braces, a
 * template's text) show the construct's type; else the name ending there, as under a cursor right
 * after it. Undefined where nothing there has a type.
 *
 * `x->f` is written as a field of the dereference `x->` (syntax: `Dereference`), but `->` reads a
 * member as `.` does, so it shows the member read, never the value behind the shared struct.
 */
export function hoverAt(program: Program, module: ModuleId, offset: number): Hover | undefined {
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    return undefined;
  }
  const ending = identifierAt(checked.tree, offset);
  for (const node of nodesAt(checked.tree, offset).toReversed()) {
    const found = nodeHover(checked, node);
    if (found !== undefined) {
      return found;
    }
  }
  return ending && nameHover(checked, ending);
}

/**
 * `type` as hover shows it: as written and what it names, and, opaque, the bounds it is known by.
 */
function shownText(checker: Checker, type: Type): string {
  const text = writtenAndNamedText(type);
  const bounds = isOpaque(type) ? checker.lookup.constraintsOf(type) : [];
  return bounds.length === 0 ? text : `${text} is ${bounds.map(constraintText).join(' & ')}`;
}

function nodeHover(checked: CheckedModule, node: SyntaxNode): Hover | undefined {
  if (node.kind === 'Dereference' && node.operator === '->') {
    return undefined;
  }
  const named = isName(node) ? nameHover(checked, node) : undefined;
  const type = named === undefined ? typeAt(checked, node) : undefined;
  return (
    named ??
    (type && {
      span: spanIn(checked.tree, node.span),
      code: [shownText(checked.checker, type)],
      doc: undefined,
    })
  );
}

/**
 * Whether `node` may name a declaration: an identifier, or a String literal naming a field as its
 * key.
 */
function isName(node: SyntaxNode): node is Identifier | StringLiteral {
  return node.kind === 'Identifier' || node.kind === 'StringLiteral';
}

/** What `name` denotes, as code: an identifier's denotations, or the field a key names (§3.1). */
function nameHover(
  { checker, module, tree }: CheckedModule,
  name: Identifier | StringLiteral,
): Hover | undefined {
  const denotations =
    name.kind === 'Identifier'
      ? checker.lookup.denotationsOf(module, name)
      : checker.lookup.keyDenotationsOf(module, name);
  if (denotations.length === 0) {
    return undefined;
  }
  const text = name.kind === 'Identifier' ? name.text : name.value;
  return {
    span: spanIn(tree, name.span),
    code: denotations.flatMap((denotation) => denotationLines(checker, text, denotation)),
    doc: denotations
      .map(({ declared }) => docstringOf(checker, declared))
      .find((doc) => doc !== undefined),
  };
}

/**
 * The type checking gave `node`: an expression's in the body holding it, a written type's as it
 * resolved. Both are keyed by their nodes themselves, so a node of any other kind is simply not
 * among them.
 */
function typeAt({ checker, module }: CheckedModule, node: SyntaxNode): Type | undefined {
  const { lookup } = checker;
  return (
    lookup.bodyHolding(module, node)?.typeOf(node as Expression) ??
    lookup.typeOfNode(module, node as TypeNode)
  );
}

/**
 * A denotation as code: a function by its signature, followed, where the name is used as a value,
 * by that value's type, which says what its signature can't (`sendable`, its type arguments).
 */
function denotationLines(
  checker: Checker,
  name: string,
  { declared, type }: Denotation,
): readonly string[] {
  const typed = (kind: string) =>
    `(${kind}) ${name}${type === undefined ? '' : `: ${shownText(checker, type)}`}`;
  switch (declared.kind) {
    case 'function': {
      const signature = signatureOf(checker, declared.declaration).label;
      return type === undefined ? [signature] : [signature, shownText(checker, type)];
    }
    case 'type':
      return [`(type) ${type === undefined ? name : shownText(checker, type)}`];
    case 'namespace':
      return [`(module) ${importedModule(checker, declared.entity)?.name ?? name}`];
    default:
      return [typed(declared.kind)];
  }
}
