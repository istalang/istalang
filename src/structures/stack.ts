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
