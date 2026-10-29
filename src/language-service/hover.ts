/**
 * What an editor shows for the spot under a pointer: for a name, what it denotes there, each
 * declaration as a line of code with its type, and the docstring of what it names; for any other
 * expression, its type.
 *
 * A name is answered through the identifier query (checker denotation.ts), as going to its
 * definition is, so the two never disagree. A shorthand, `Pair{first}`, names a field and a
 * variable, and shows both. A function shows its signature, which spells its type with its
 * parameters' names.
 */

import { localFunctionOf } from '../compiler/binder/entities.ts';
import type { Checker } from '../compiler/checker/check.ts';
import type { Denotation } from '../compiler/checker/denotation.ts';
import type { Type } from '../compiler/checker/types/type.ts';
import { typeText } from '../compiler/checker/types/type-text.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import type { Expression } from '../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../compiler/syntax/node.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { nodesAt, type SyntaxNode } from '../compiler/syntax/tree.ts';
import type { Span } from '../text/span.ts';
import { type CheckedModule, checkedModule } from './checked-module.ts';
import { identifierAt } from './identifier-at.ts';
import { importedModule } from './namespaces.ts';
import { signatureOf } from './signatures.ts';

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

function nodeHover(checked: CheckedModule, node: SyntaxNode): Hover | undefined {
  if (node.kind === 'Dereference' && node.operator === '->') {
    return undefined;
  }
  const named = node.kind === 'Identifier' ? nameHover(checked, node) : undefined;
  const type = named === undefined ? typeAt(checked, node) : undefined;
  return (
    named ??
    (type && { span: spanIn(checked.tree, node.span), code: [typeText(type)], doc: undefined })
  );
}

function nameHover({ checker, module, tree }: CheckedModule, name: Identifier): Hover | undefined {
  const denotations = checker.lookup.denotationsOf(module, name);
  if (denotations.length === 0) {
    return undefined;
  }
  return {
    span: spanIn(tree, name.span),
    code: denotations.flatMap((denotation) => denotationLines(checker, name, denotation)),
    doc: denotations
      .map(({ declared }) => docOf(checker, declared))
      .find((doc) => doc !== undefined),
  };
}

/**
 * The type checking gave `node`. A body's types are keyed by its expression nodes themselves, so a
 * node of any other kind is simply not among them.
 */
function typeAt({ checker, module }: CheckedModule, node: SyntaxNode): Type | undefined {
  return checker.lookup.bodyHolding(module, node)?.typeOf(node as Expression);
}

/**
 * A denotation as code: a function by its signature, followed, where the name is used as a value,
 * by that value's type, which says what its signature can't (`sendable`, its type arguments).
 */
function denotationLines(
  checker: Checker,
  name: Identifier,
  { declared, type }: Denotation,
): readonly string[] {
  const typed = (kind: string) =>
    `(${kind}) ${name.text}${type === undefined ? '' : `: ${typeText(type)}`}`;
  switch (declared.kind) {
    case 'function': {
      const signature = signatureOf(checker, declared.declaration).label;
      return type === undefined ? [signature] : [signature, typeText(type)];
    }
    case 'type':
      return [`(type) ${type === undefined ? name.text : typeText(type)}`];
    case 'namespace':
      return [`(module) ${importedModule(checker, declared.entity)?.name ?? name.text}`];
    default:
      return [typed(declared.kind)];
  }
}

/** The docstring of what `declared` names, for the declarations that may have one (§2). */
function docOf(checker: Checker, declared: Denotation['declared']): string | undefined {
  switch (declared.kind) {
    case 'function':
      return declared.declaration.doc?.value;
    case 'type': {
      const { entity } = declared;
      return entity.kind === 'type' && 'doc' in entity.declaration
        ? entity.declaration.doc?.value
        : undefined;
    }
    case 'namespace':
      return importedModule(checker, declared.entity)?.tree.root.doc?.value;
    case 'variable': {
      const local = localFunctionOf(declared.entity);
      return local?.kind === 'FunctionDeclaration' ? local.doc?.value : undefined;
    }
    default:
      return undefined;
  }
}
