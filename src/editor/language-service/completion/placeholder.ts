/**
 * The place of a cursor no member or literal field claims, read by parsing the module with a
 * placeholder name written at the cursor, as rust-analyzer and IntelliJ do: what the grammar makes
 * of a name there is what may be written there, so the parser stays the one home of the grammar,
 * and code being typed, broken or unfinished, is read the way the parser recovers it. The
 * placeholder joins any name half written at the cursor, a keyword's spelling included.
 *
 * The placeholder's nearest enclosing node that decides a role names the place: a type (but for a
 * literal's or a struct pattern's name, which the tree holds as one and which writes a value or a
 * pattern), a declared name, a pattern (a `case` or `is` pattern, which tests; a `let`, `for` or
 * parameter pattern declares names instead, as an `as` in any pattern does), a struct pattern's
 * field, a call's argument, an import, an annotation. An expression inside one of these (a compared
 * field's value, an argument's or a field's value) is the grammar's again. A few positions the
 * parser can't tell apart from others are read from the tokens: `new` (a type follows), `async`
 * (only `fn` follows, where the parser reads a lambda's parameter), a line opening with `import` or
 * `@`, and a `<` touching a callee (type arguments, not a comparison).
 *
 * The text of templates, docstrings and numbers takes nothing, as a comment does (place.ts); a
 * String literal's text takes the literals a value expected there may be (places/string-text.ts).
 */

import { parse } from '../../../compiler/parser/parse.ts';
import { scan } from '../../../compiler/scanner/scan.ts';
import {
  buildsShared,
  literalNaming,
} from '../../../compiler/syntax/expressions/literals/built-types.ts';
import {
  declaredTargets,
  ownsTargets,
  type TargetOwner,
} from '../../../compiler/syntax/statements/targets.ts';
import type { TokenKind } from '../../../compiler/syntax/tokens/index.ts';
import {
  extentIn,
  nodesAt,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../compiler/syntax/tree/node.ts';
import { isWrittenType } from '../../../compiler/syntax/types/index.ts';
import { createSourceText } from '../../../foundation/text/source-text.ts';
import { codeTokensOf } from '../reading/tokens.ts';
import type { Cursor } from './cursor.ts';

/**
 * The places this reading decides with code around them: all but a member's and a literal field's.
 */
type ParsedPlaceKind =
  | 'grammar'
  | 'stringText'
  | 'type'
  | 'declaredName'
  | 'callArgument'
  | 'pattern'
  | 'patternField'
  | 'import'
  | 'annotation';

/**
 * The module parsed with the placeholder at the cursor, which providers read for the construct
 * around it. Its nodes are not the checked tree's: one a checker query needs is found there by
 * position, which is the same before the cursor.
 */
export interface PlaceholderParse {
  readonly tree: SyntaxTree;
  /** The nodes holding the placeholder, from the root to the innermost. */
  readonly chain: readonly SyntaxNode[];
  /** Where the placeholder starts: the cursor's offset. */
  readonly offset: number;
}

/** One place per kind this reading decides, with the parse it was read from. */
export type ParsedPlace = {
  readonly [Kind in ParsedPlaceKind]: { readonly kind: Kind; readonly parsed: PlaceholderParse };
}[ParsedPlaceKind];

/** Where no code is written: a comment, or the text of a string, a docstring or a number. */
export interface NothingPlace {
  readonly kind: 'nothing';
}

export const nothingPlace: NothingPlace = { kind: 'nothing' };

/** A name no program writes by chance; its value is never read. */
const placeholder = 'completionPlaceholder';

/** The place at `cursor`, as the parser reads a name written there. */
export function parsedPlaceAt(cursor: Cursor): ParsedPlace | NothingPlace {
  const parsed = placeholderParse(cursor);
  const kind = kindAt(cursor, parsed);
  return kind === 'nothing' ? nothingPlace : { kind, parsed };
}

function kindAt(cursor: Cursor, parsed: PlaceholderParse): ParsedPlaceKind | 'nothing' {
  const { chain } = parsed;
  if (chain.some(isImport) || lineOpensWith(cursor, 'import')) {
    return 'import';
  }
  if (chain.at(-1)?.kind === 'StringLiteral') {
    return 'stringText';
  }
  if (isLiteralText(chain.at(-1)) || touchesNumber(cursor)) {
    return 'nothing';
  }
  if (cursor.before?.kind === 'async') {
    return 'grammar';
  }
  return (
    roleOf(parsed) ??
    (lineOpensWith(cursor, '@') ? 'annotation' : undefined) ??
    (followsNew(cursor) ? 'type' : 'grammar')
  );
}

/**
 * The module's text with the placeholder at the cursor, parsed reusing what the edit left alike.
 */
function placeholderParse({ tree, offset }: Cursor): PlaceholderParse {
  const { path, text } = tree.source;
  const source = createSourceText(path, text.slice(0, offset) + placeholder + text.slice(offset));
  const scanned = scan(source);
  const parsed = parse(source, scanned, tree);
  return { tree: parsed, chain: nodesAt(parsed, offset), offset };
}

/** Whether the cursor is in a comment, which holds no code whatever surrounds it. */
export function isInComment({ tree, offset }: Cursor): boolean {
  return tree.comments.some(({ span }) => span.start < offset && offset <= span.end);
}

function isImport(node: SyntaxNode): boolean {
  return node.kind === 'NamedImport' || node.kind === 'NamespaceImport';
}

/** The placeholder fell inside a template's or a docstring's text, not in code. */
function isLiteralText(node: SyntaxNode | undefined): boolean {
  return node?.kind === 'TemplateText' || node?.kind === 'Docstring';
}

const numbers: ReadonlySet<string> = new Set(['integer', 'float', 'duration']);

function touchesNumber({ before, name, offset }: Cursor): boolean {
  return name === undefined && before?.span.end === offset && numbers.has(before.kind);
}

/**
 * Whether the first token of the cursor's line is `opener`, as a line holding an import is; a
 * line with no token before the cursor opens with nothing, whatever the lines above it hold.
 */
function lineOpensWith({ tree, offset }: Cursor, opener: TokenKind): boolean {
  const first = codeTokensOf(tree).findLast(
    ({ span, firstOnLine }) => firstOnLine && span.start < offset,
  );
  return first?.kind === opener && !tree.source.text.slice(first.span.start, offset).includes('\n');
}

/**
 * `new` before the name: a shared struct's name follows (§3.1), read by the parser only with its
 * `{`.
 */
export function followsNew({ tree, before }: Cursor): boolean {
  return (
    before?.kind === 'identifier' &&
    tree.source.text.slice(before.span.start, before.span.end) === 'new'
  );
}

/** The role of the placeholder in the innermost node deciding one, if any. */
function roleOf(parsed: PlaceholderParse): ParsedPlaceKind | undefined {
  const { chain } = parsed;
  const innermost = chain.at(-1);
  const links = chain.map((node, index) => ({
    node,
    child: chain[index + 1],
    holder: chain[index - 1],
  }));
  for (const { node, child, holder } of links.toReversed()) {
    const role = roleIn({
      parsed,
      node,
      child,
      holder,
      innermost: child !== undefined && child === innermost,
    });
    if (role !== undefined) {
      return role;
    }
  }
  return undefined;
}

/**
 * A node on the way to the placeholder, its child on that way and the node holding it:
 * `innermost` when the child is the placeholder's own node.
 */
interface Link<Node extends SyntaxNode> {
  readonly parsed: PlaceholderParse;
  readonly node: Node;
  readonly child: SyntaxNode | undefined;
  readonly holder: SyntaxNode | undefined;
  readonly innermost: boolean;
}

type Role<Node extends SyntaxNode> = (link: Link<Node>) => ParsedPlaceKind | undefined;

/** The role `link.node` gives its child, if it decides one. */
function roleIn(link: Link<SyntaxNode>): ParsedPlaceKind | undefined {
  const { node, child } = link;
  if (child !== undefined && declaresName(node, child)) {
    return 'declaredName';
  }
  if (isWrittenType(node)) {
    return builtNameRole(link) ?? 'type';
  }
  const role = roles[node.kind] as Role<SyntaxNode> | undefined;
  return role?.(link);
}

/**
 * The name a struct or variant literal builds, or a struct or call pattern tests, which the tree
 * holds as a written type: a value is written there (`Ok‸{value: v}`, `Ok‸:`), or a pattern
 * (`case Ok‸{value}`, `case Ok‸(v)`). A shared struct's literal (`new P‸{…}`) and a struct pattern
 * a declaration destructures with (`const Pair‸{first} = p`) name a type.
 */
function builtNameRole({ parsed, node, holder }: Link<SyntaxNode>): ParsedPlaceKind | undefined {
  const literal = literalNaming(holder, node);
  if (literal !== undefined) {
    return buildsShared(literal) ? undefined : 'grammar';
  }
  const heads =
    (holder?.kind === 'StructPattern' && holder.type === node) ||
    (holder?.kind === 'VariantCallPattern' && holder.callee === node);
  return heads && isTested(parsed, holder) ? 'pattern' : undefined;
}

/** Whether `pattern` is tested, by a `case` or an `is`, rather than declaring names. */
function isTested({ chain }: PlaceholderParse, pattern: SyntaxNode): boolean {
  const owner = chain
    .slice(0, chain.indexOf(pattern))
    .findLast((node) => testers.has(node.kind) || ownsTargets(node));
  return owner !== undefined && testers.has(owner.kind);
}

const testers: ReadonlySet<string> = new Set(['MatchCase', 'Is']);

/** A target a declaration, a loop or a parameter declares, where a new name is written. */
const holdsTargets: Role<Extract<SyntaxNode, TargetOwner>> = ({ node, child }) =>
  declaredTargets(node).some((target) => target === child) ? 'declaredName' : undefined;

/** The nodes, by kind, giving the placeholder a role of their own. */
// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const roles: { readonly [Kind in SyntaxNode['kind']]?: Role<Extract<SyntaxNode, { kind: Kind }>> } =
  {
    Annotation: () => 'annotation',
    Call: ({ node, child, innermost }) => (innermost ? argumentRole(node, child) : undefined),
    NamedArgument: ({ node, child }) => (child === node.name ? 'callArgument' : 'grammar'),
    MatchCase: caseRole,
    Is: ({ node, child }) => (child === node.pattern ? 'pattern' : undefined),
    SelectCase: ({ node, child }) => (child === node.binding ? 'declaredName' : 'grammar'),
    VariableDeclaration: holdsTargets,
    For: holdsTargets,
    Comprehension: holdsTargets,
    FieldHeader: holdsTargets,
    Parameter: holdsTargets,
    Binary: ({ parsed, node, child }) =>
      child === node.right && opensTypeArguments(parsed, node) ? 'type' : undefined,
    BindFieldPattern: ({ node, child }) =>
      child === node.alias ? 'declaredName' : fieldRole(node, child),
    CompareFieldPattern: ({ node, child }) =>
      child === node.value ? 'grammar' : fieldRole(node, child),
    NestedFieldPattern: ({ node, child }) => fieldRole(node, child),
    FieldInitializer: ({ node, child }) => (child === node.value ? 'grammar' : undefined),
  };
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A struct pattern's item, where its field is named. */
function fieldRole(
  item: { readonly field: Identifier },
  child: SyntaxNode | undefined,
): ParsedPlaceKind | undefined {
  return child === item.field ? 'patternField' : undefined;
}

/**
 * A call's argument written as the placeholder alone. `hold(name)` reads as a call until the
 * `let`, `const` or `_` after it: its label is no argument. A name the parser could make no
 * argument of, after another with no comma between, goes on after that one: the grammar's.
 */
function argumentRole(
  call: Extract<SyntaxNode, { kind: 'Call' }>,
  child: SyntaxNode | undefined,
): ParsedPlaceKind | undefined {
  if (child?.kind === 'Invalid' || !call.arguments.some((argument) => argument === child)) {
    return undefined;
  }
  const { callee } = call;
  return callee.kind === 'Identifier' && callee.text === 'hold' ? 'grammar' : 'callArgument';
}

/**
 * A `case`'s pattern, or its guard once `if` is written, until its `:`: the parser takes a case it
 * can't finish as ended, and what follows as the arm.
 */
function caseRole({
  parsed,
  node,
  child,
}: Link<Extract<SyntaxNode, { kind: 'MatchCase' }>>): ParsedPlaceKind | undefined {
  if (child === node.pattern) {
    return 'pattern';
  }
  if (child !== node.body) {
    return 'grammar';
  }
  const patternEnd = extentIn(parsed.tree, node.pattern).end;
  const opensArm = codeTokensOf(parsed.tree).some(
    ({ kind, span }) => kind === ':' && span.start >= patternEnd && span.end <= parsed.offset,
  );
  if (opensArm) {
    return undefined;
  }
  return node.guard === undefined ? 'pattern' : 'grammar';
}

/** A `<` right after its left operand's last character, as in `create<T>(…)`. */
function opensTypeArguments(
  parsed: PlaceholderParse,
  node: Extract<SyntaxNode, { kind: 'Binary' }>,
): boolean {
  const leftEnd = extentIn(parsed.tree, node.left).end;
  return node.operator === '<' && parsed.tree.source.text.startsWith('<', leftEnd);
}

/** Nodes declaring the name they hold as `name`. */
const declaringKinds: ReadonlySet<string> = new Set([
  'AsPattern',
  'FunctionDeclaration',
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'ExternConstantDeclaration',
  'EnumDeclaration',
  'Variant',
  'TraitDeclaration',
  'TypeAliasDeclaration',
  'AssociatedType',
  'RequiredAssociatedType',
  'TypeParameter',
  'Parameter',
  'DeclaredField',
  'FieldDeclaration',
  'Lambda',
]);

/** Whether `node` declares `child`, or names with it the type a static function is declared on. */
function declaresName(node: SyntaxNode, child: SyntaxNode): boolean {
  if (node.kind === 'FunctionDeclaration' && node.owner === child) {
    return true;
  }
  return declaringKinds.has(node.kind) && 'name' in node && node.name === child;
}
