/**
 * A Definition: the whole compiled program, the contract between lowering and every backend
 * (docs/arch/definition.md), and the one home of its persisted form.
 *
 * It is a flat set of tables (modules, types, functions, constants) that refer to each other by
 * index. A deploy writes it once; the store keys its bytes by their hash, and every instance refers
 * to that hash for its whole life.
 *
 * - Its bytes are avsc's (formats/binary-format.ts), derived from its zod schema, which never runs
 *   on one. Whatever carries a Definition carries an `EncodedDefinition`, or the text a built module
 *   embeds; nothing outside this module knows how either is encoded.
 * - Validation covers more than shapes (./validation/): every index lands in its table, every
 *   instruction's registers have the types it needs, and every owned register is let go of exactly
 *   once on every path (the ownership verifier). It runs where bytes come from outside the
 *   toolchain (a store, a file), so a hand-edited or corrupted Definition is refused at load, never
 *   midway through an instance; the toolchain's own output is trusted, encoded once and not read
 *   back.
 */

import type { z } from 'zod';
import { base64Of, bytesOfBase64 } from '../foundation/text/base64.ts';
import { contentHash, defineBinaryFormat } from './formats/binary-format.ts';
import { FormatError } from './formats/format.ts';
import { tables } from './tables/index.ts';
import { validationIssues } from './validation/index.ts';

export type Definition = z.output<typeof tables>;

const name = 'istalang-definition';

const version = 5;

const definitionFormat = defineBinaryFormat(name, version, tables);

/** A Definition and the hash its bytes are keyed by. */
export interface KeyedDefinition {
  readonly definition: Definition;
  readonly hash: string;
}

/** A Definition with its persisted bytes and their hash. */
export interface EncodedDefinition extends KeyedDefinition {
  readonly bytes: Uint8Array;
}

/** The toolchain's own Definition, encoded once; throws FormatError where it doesn't fit. */
export function encodeDefinition(definition: Definition): EncodedDefinition {
  const bytes = definitionFormat.write(definition);
  return { definition, bytes, hash: contentHash(bytes) };
}

/** Bytes from outside the toolchain (a store, a file), decoded and validated; throws FormatError. */
export function readDefinition(bytes: Uint8Array): EncodedDefinition {
  const definition = definitionFormat.read(bytes);
  requireValid(definition);
  return { definition, bytes, hash: contentHash(bytes) };
}

/** Throws FormatError naming every way `definition` breaks what validation checks. */
export function requireValid(definition: Definition): void {
  const issues = validationIssues(definition);
  if (issues.length > 0) {
    throw new FormatError(
      `Invalid ${name} body:\n${issues.map((issue) => `✖ ${issue}`).join('\n')}`,
    );
  }
}

/** Where the hash ends in an embedded Definition's text, its bytes following. */
const embeddedSeparator = ':';

/** The text a built module embeds `encoded` as: its hash and its bytes. */
export function embeddedText({ hash, bytes }: EncodedDefinition): string {
  return `${hash}${embeddedSeparator}${base64Of(bytes)}`;
}

/** The Definition a built module embedded as `text`, the toolchain's own: decoded alone. */
export function embeddedDefinition(text: string): KeyedDefinition {
  const separator = text.indexOf(embeddedSeparator);
  return {
    definition: definitionFormat.read(bytesOfBase64(text.slice(separator + 1))),
    hash: text.slice(0, separator),
  };
}
