import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NodeNumbering } from './node-numbering.ts';
import { NodeRelation } from './node-relation.ts';

type Step =
  | { readonly kind: 'add'; readonly from: number; readonly to: number }
  | { readonly kind: 'delete'; readonly node: number }
  | { readonly kind: 'addAllOf'; readonly into: number; readonly from: number }
  | { readonly kind: 'join'; readonly from: number; readonly to: number };

/** The same relation as sets of pairs, the meaning the rows of bits keep. */
class SetRelation {
  readonly rows = new Map<number, Set<number>>();

  add(from: number, to: number): void {
    this.rows.set(from, (this.rows.get(from) ?? new Set()).add(to));
  }

  delete(node: number): void {
    this.rows.delete(node);
    for (const row of this.rows.values()) {
      row.delete(node);
    }
  }

  addAllOf(into: number, from: number): void {
    for (const each of [...(this.rows.get(from) ?? [])]) {
      if (each !== into && into !== from) {
        this.add(into, each);
      }
    }
  }
}

// Node ids span negatives (globals) and a range wider than one word.
const anyNode = fc.integer({ min: -3, max: 70 });
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('add' as const), from: anyNode, to: anyNode }),
  fc.record({ kind: fc.constant('delete' as const), node: anyNode }),
  fc.record({ kind: fc.constant('addAllOf' as const), into: anyNode, from: anyNode }),
  fc.record({ kind: fc.constant('join' as const), from: anyNode, to: anyNode }),
);

/** Takes `each` on both relations. */
function take(each: Step, bits: NodeRelation, sets: SetRelation, numbering: NodeNumbering): void {
  switch (each.kind) {
    case 'add':
      bits.add(each.from, each.to);
      sets.add(each.from, each.to);
      return;
    case 'delete':
      bits.delete(each.node);
      sets.delete(each.node);
      return;
    case 'addAllOf':
      bits.addAllOf(each.into, each.from);
      sets.addAllOf(each.into, each.from);
      return;
    default: {
      const other = new NodeRelation(numbering);
      other.add(each.from, each.to);
      bits.join(other);
      sets.add(each.from, each.to);
    }
  }
}

describe('NodeRelation', () => {
  it('holds the pairs a relation of sets would, whatever the steps', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 80 }), (steps) => {
        const numbering = new NodeNumbering();
        const bits = new NodeRelation(numbering);
        const sets = new SetRelation();
        for (const each of steps) {
          take(each, bits, sets, numbering);
        }
        for (const [from, row] of sets.rows) {
          expect(new Set(bits.targets(from))).toEqual(row);
        }
        expect(bits.size()).toBe([...sets.rows.values()].reduce((sum, row) => sum + row.size, 0));
      }),
    );
  });
});
