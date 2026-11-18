/**
 * Compressed forms: a construct that may stand on one line, through `{ … }` with `,` or `;`, or a
 * body on its header's line, stands there only when its whole line keeps within the compact
 * width, two thirds of the width; anything else breaks only past the width.
 *
 * Prettier's printer measures every group against one width, so a compressed form is a group
 * marked here (`compactGroup`), and `withCompactWidths` gives each its narrower limit before the
 * doc is printed: its flat form ends in a reserve of placeholder characters, as many as the two
 * widths differ by, so it fits only where its line keeps within the compact width; the printed
 * text then drops them (`withoutPlaceholders`). The placeholder is a character the source doesn't
 * hold, so dropping it removes nothing written.
 *
 * A line holds one reserve: a compressed form inside another reserves only while the outer one is
 * broken, since one standing flat inside a flat one shares its line, which the outer reserve
 * already keeps short. Text after a flat compressed form on its line sees the reserve too, so a
 * line holding one keeps within the compact width to its end.
 */

import { builders } from 'prettier/doc';

const { group, ifBreak } = builders;

type Doc = builders.Doc;

const compactGroups = new WeakSet<builders.Group>();

/** `contents` as a group that stands flat only within the compact width. */
export function compactGroup(contents: Doc): Doc {
  const made = group(contents);
  compactGroups.add(made);
  return made;
}

/**
 * The group `doc` made a compressed form, when it is one (a list's brackets may make an empty
 * list a plain string instead).
 */
export function asCompact(doc: Doc): Doc {
  if (isGroup(doc)) {
    compactGroups.add(doc);
  }
  return doc;
}

/** The private-use characters a placeholder is taken from, the first the source doesn't hold. */
const firstPrivateUse = 0xe0_00;
const lastPrivateUse = 0xf8_ff;

/** A character `text` doesn't hold, to reserve width with. */
export function placeholderFor(text: string): string {
  for (let code = firstPrivateUse; code <= lastPrivateUse; code += 1) {
    const candidate = String.fromCodePoint(code);
    if (!text.includes(candidate)) {
      return candidate;
    }
  }
  throw new Error('The source holds every private-use character, so none can reserve width.');
}

/** `printed` without the reserves `withCompactWidths` added. */
export function withoutPlaceholders(printed: string, placeholder: string): string {
  return printed.replaceAll(placeholder, '');
}

/** `root` with each compressed form's flat contents ending in `reserve` (banner). */
export function withCompactWidths(root: Doc, reserve: string): Doc {
  const mapped = new Map<symbol | undefined, Map<Doc, Doc>>();
  const walk = (node: Doc, enclosing: symbol | undefined): Doc => {
    if (typeof node === 'string') {
      return node;
    }
    let ofEnclosing = mapped.get(enclosing);
    if (ofEnclosing === undefined) {
      ofEnclosing = new Map();
      mapped.set(enclosing, ofEnclosing);
    }
    const known = ofEnclosing.get(node);
    if (known !== undefined) {
      return known;
    }
    const result = mapNode(node, enclosing, walk, reserve);
    ofEnclosing.set(node, result);
    return result;
  };
  return walk(root, undefined);
}

type Walk = (node: Doc, enclosing: symbol | undefined) => Doc;

function mapNode(node: Doc, enclosing: symbol | undefined, walk: Walk, reserve: string): Doc {
  if (Array.isArray(node)) {
    return node.map((part) => walk(part, enclosing));
  }
  if (typeof node === 'string') {
    return node;
  }
  switch (node.type) {
    case 'group':
      return compactGroups.has(node)
        ? reserving(node, enclosing, walk, reserve)
        : { ...node, contents: walk(node.contents, enclosing), ...statesOf(node, enclosing, walk) };
    case 'fill':
      return { ...node, parts: node.parts.map((part) => walk(part, enclosing)) };
    case 'if-break':
      return {
        ...node,
        breakContents: walk(node.breakContents, enclosing),
        flatContents: walk(node.flatContents, enclosing),
      };
    // The formatter builds no `indent-if-break`, which Prettier's types give no contents.
    case 'indent':
    case 'align':
    case 'line-suffix':
    case 'label':
      return { ...node, contents: walk(node.contents, enclosing) };
    default:
      return node;
  }
}

/** A conditional group's states walked; nothing for any other group, which has none. */
function statesOf(
  node: builders.Group,
  enclosing: symbol | undefined,
  walk: Walk,
): Partial<builders.Group> {
  // Prettier's types give every group its states; only a conditional group has them.
  const states: readonly Doc[] | undefined = node.expandedStates;
  return states === undefined
    ? {}
    : { expandedStates: states.map((state) => walk(state, enclosing)) };
}

/** A compressed form whose flat contents end in `reserve`, unless one around it stands flat. */
function reserving(
  node: builders.Group,
  enclosing: symbol | undefined,
  walk: Walk,
  reserve: string,
): Doc {
  const id = Symbol('compact');
  const whileOuterBroken =
    enclosing === undefined ? reserve : ifBreak(reserve, '', { groupId: enclosing });
  return { ...node, id, contents: [walk(node.contents, id), ifBreak('', whileOuterBroken)] };
}

function isGroup(node: Doc): node is builders.Group {
  return typeof node === 'object' && !Array.isArray(node) && node.type === 'group';
}
