/**
 * The M2.4 subset program: primitives, functions, `let`/`const`, `if`/`while`/`return` and a
 * struct. `main` gives 98: the sum of fib(0..9) is 88, plus the loop counter's final 10.
 */

export const subsetSource = `struct Point { x: Int, y: Int }

fn fib(n: Int) -> Int:
  if n < 2:
    return n
  fib(n - 1) + fib(n - 2)

live async fn main():
  let total = 0
  let i = 0
  while i < 10:
    total = total + fib(i)
    i = i + 1
  const p = Point{x: total, y: i}
  p.x + p.y
`;

export const subsetOutcome = 98n;
