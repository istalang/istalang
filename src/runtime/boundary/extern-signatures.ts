/**
 * One name, one type (§3.6): the runtime remembers the declared type of every extern a host
 * implements, by its key, across every Definition it deploys, and refuses a Definition that
 * declares one of them differently. A key already spells a function's parameter types, so what can
 * differ under one key is a function's result or a constant's type, which a host provides against.
 *
 * What it remembers is a text in its store (runtime/store.ts), in a format of its own: each key's
 * type as keys spell types, `purchase.chargeCard(String, Int)` → `prelude.Result<String>`.
 */

import { z } from 'zod';
import type { Definition } from '../../definition/definition.ts';
import { defineFormat } from '../../definition/formats/format.ts';
import { Refusal } from '../refusal.ts';
import type { InstanceStore } from '../store.ts';

const externSignaturesFormat = defineFormat(
  'istalang-externs',
  1,
  z.record(z.string(), z.string()),
);

/**
 * Records the declared types of the externs `definition`'s host implements in `store`; a Refusal,
 * recording nothing, when one differs from what the store already holds under its key.
 */
export function recordExternSignatures(store: InstanceStore, definition: Definition): void {
  const text = store.readExterns();
  const known: Record<string, string> =
    text === undefined ? {} : { ...externSignaturesFormat.read(text) };
  const declared = definition.functions.flatMap((entry) =>
    entry.kind === 'extern' && entry.host !== undefined
      ? [[entry.key, entry.host.declaredType] as const]
      : [],
  );
  const changed = declared.filter(([key, type]) => known[key] !== undefined && known[key] !== type);
  if (changed.length > 0) {
    const listed = changed.map(([key, type]) => `${key}: ${type}, not ${known[key]}`).join('; ');
    throw new Refusal(
      'externChanged',
      `The program declares externs differently from before: ${listed}.`,
    );
  }
  const added = declared.filter(([key]) => known[key] === undefined);
  if (added.length > 0) {
    store.writeExterns(externSignaturesFormat.write({ ...known, ...Object.fromEntries(added) }));
  }
}
