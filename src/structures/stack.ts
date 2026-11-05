/**
 * A stack whose top is what is being worked on right now: an item is pushed for the duration of the
 * work it starts and popped however that work ends, so the stack always describes the work still
 * in progress.
 */

/** Runs `work` with `item` pushed onto `stack`, popping it afterwards, even when `work` throws. */
export function withPushed<Item, Result>(stack: Item[], item: Item, work: () => Result): Result {
  stack.push(item);
  try {
    return work();
  } finally {
    stack.pop();
  }
}

/**
 * Runs `work` on `stack` emptied, as the start of work of its own that what is under way around it
 * never reaches into, putting the items back afterwards, even when `work` throws.
 */
export function withEmptied<Item, Result>(stack: Item[], work: () => Result): Result {
  const around = stack.splice(0);
  try {
    return work();
  } finally {
    stack.splice(0, stack.length);
    pushAll(stack, around);
  }
}

/** Pushes `items` onto `stack` one by one: spreading a long list would overflow the host's stack. */
export function pushAll<Item>(stack: Item[], items: Iterable<Item>): void {
  for (const item of items) {
    stack.push(item);
  }
}
