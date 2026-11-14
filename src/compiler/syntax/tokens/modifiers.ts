/**
 * The modifiers a head stacks before its keyword, `fn` or `struct` (§2): a function's, a function
 * type's, a lambda's, an extern's or a struct's. They stack in any order, each at most once
 * and one word of each group, and print in one order, the groups': `extern`; what a value may
 * capture or which handle it is; the function's mark; whether it awaits. Parsing, completion and
 * every printer read these tables, so a modifier is added here alone.
 *
 * - A group's words exclude each other: a head is `sendable`, `inert` or neither, `live`, `ista` or
 *   neither, `async` or not, one handle. A word implying another of its group is the exception
 *   (`implied`): `sendable` implies `inert` (§3.14), so a head writing both is `sendable`, and
 *   prints so.
 * - `sendable` before `fn` is the function's sendability and before `struct` an extern struct's
 *   handle, `live` a function's mark or an extern struct's handle, and `shared` a handle or a
 *   shared struct's own word. The form tells them apart, so a word may stand in two groups no form
 *   holds together.
 * - A form is a head where it stands, with the groups it takes: a function type takes its
 *   sendability, while a lambda's follows from its captures (§3.14).
 * - A function's qualifiers, its sendability, mark and `async`, are what its type keeps of its
 *   head; a declaration's `extern` and an extern struct's handle stay on the declaration.
 */

import type { ContextualWord, Keyword } from './index.ts';

/** Each group's words, the groups in the order heads print them. */
export const modifierGroups = {
  extern: ['extern'],
  handle: ['shared', 'sendable', 'live'],
  shared: ['shared'],
  send: ['sendable', 'inert'],
  kind: ['live', 'ista'],
  async: ['async'],
} as const satisfies Record<string, readonly (Keyword | ContextualWord)[]>;

export type ModifierGroup = keyof typeof modifierGroups;

export type ModifierWord<Group extends ModifierGroup = ModifierGroup> =
  (typeof modifierGroups)[Group][number];

/** A head's modifiers by group. */
export type Modifiers = { readonly [Group in ModifierGroup]?: ModifierWord<Group> | undefined };

/**
 * What a function's head says of it: what its value may capture, its mark (proposal 8, Rule 2),
 * and whether its body may await.
 */
export interface FunctionQualifiers {
  readonly send: ModifierWord<'send'> | undefined;
  readonly kind: ModifierWord<'kind'> | undefined;
  readonly async: ModifierWord<'async'> | undefined;
}

export const unqualified: FunctionQualifiers = {
  send: undefined,
  kind: undefined,
  async: undefined,
};

/**
 * Whether a function of `qualifiers` is async: its body may await, and its call gives a future
 * (§3.14). The one reading of `async` outside the parser and the printers.
 */
export function awaits(qualifiers: FunctionQualifiers): boolean {
  return qualifiers.async !== undefined;
}

const groupOrder = Object.keys(modifierGroups) as readonly ModifierGroup[];

/** The word each word of a group implies, which a head writing both means no more than it. */
const implied: Readonly<Partial<Record<ModifierWord, ModifierWord>>> = { sendable: 'inert' };

/** The one of two words of a group a head writing both means; undefined where they conflict. */
export function strongerOf(first: ModifierWord, second: ModifierWord): ModifierWord | undefined {
  if (implied[first] === second) {
    return first;
  }
  return implied[second] === first ? second : undefined;
}

const modifierWordSet: ReadonlySet<string> = new Set(Object.values(modifierGroups).flat());

export function isModifierWord(word: string): word is ModifierWord {
  return modifierWordSet.has(word);
}

/** A head where it stands: its keyword, the groups it takes in their order, and its name. */
export interface HeadForm {
  readonly keyword: 'fn' | 'struct' | 'const';
  readonly groups: readonly ModifierGroup[];
  readonly name: string;
}

export const headForms = {
  /** A defined, local or extern function's. */
  function: { keyword: 'fn', groups: ['extern', 'kind', 'async'], name: 'a function declaration' },
  requirement: { keyword: 'fn', groups: ['kind', 'async'], name: "a trait's function" },
  lambda: { keyword: 'fn', groups: ['kind', 'async'], name: 'a lambda' },
  functionType: { keyword: 'fn', groups: ['send', 'kind', 'async'], name: 'a function type' },
  externStruct: { keyword: 'struct', groups: ['extern', 'handle'], name: 'an extern struct' },
  sharedStruct: { keyword: 'struct', groups: ['shared'], name: 'a shared struct' },
  struct: { keyword: 'struct', groups: [], name: 'a struct' },
  /** A top-level `ista const` (§3.4), whose one word is its kind, `ista` alone. */
  contextConstant: { keyword: 'const', groups: ['kind'], name: 'a context constant' },
} as const satisfies Record<string, HeadForm>;

/** The group of `form` holding `word`, if `form` takes it. */
export function groupIn(form: HeadForm, word: ModifierWord): ModifierGroup | undefined {
  return form.groups.find((group) => (modifierGroups[group] as readonly string[]).includes(word));
}

/**
 * What may follow `word` in a head of `form` written in print order: the form's keyword, or a
 * later group's modifier; nothing where `form` doesn't take `word`.
 */
export function followersIn(
  form: HeadForm,
  word: ModifierWord,
): readonly (Keyword | ContextualWord)[] {
  const group = groupIn(form, word);
  if (group === undefined) {
    return [];
  }
  const later = form.groups.slice(form.groups.indexOf(group) + 1);
  return [form.keyword, ...later.flatMap((each) => modifierGroups[each])];
}

/** What may start a head of `form`: its keyword, or any of its modifiers. */
export function startsOf<Form extends HeadForm>(
  form: Form,
): readonly (Form['keyword'] | ModifierWord<Form['groups'][number]>)[] {
  return [form.keyword, ...form.groups.flatMap((group) => modifierGroups[group])];
}

/** A function's qualifiers among a head's modifiers. */
export function qualifiersOf({ send, kind, async }: Modifiers): FunctionQualifiers {
  return { send, kind, async };
}

/**
 * `modifiers` as a head prints them, in their groups' order, each followed by a space; `mark`, the
 * text of a mark the head names (`M`, `Self.Mode`), stands where a kind's word would.
 */
export function modifiersText(modifiers: Modifiers, mark?: string): string {
  const [before, after] = modifiersAroundMark(modifiers);
  const kind = modifiers.kind ?? mark;
  return `${before}${kind === undefined ? '' : `${kind} `}${after}`;
}

/**
 * The text of `modifiers` a head prints before its mark and after it, each word followed by a
 * space, so a printer can print a named mark (`M`) between them as a node of its own.
 */
export function modifiersAroundMark(modifiers: Modifiers): readonly [string, string] {
  const at = groupOrder.indexOf('kind');
  const text = (groups: readonly ModifierGroup[]) =>
    groups.map((group) => (modifiers[group] === undefined ? '' : `${modifiers[group]} `)).join('');
  return [text(groupOrder.slice(0, at)), text(groupOrder.slice(at + 1))];
}
