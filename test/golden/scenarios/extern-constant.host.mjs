/** The host of extern-constant.ista: each read of `seed` gives the next number. */
let reads = 0;

export default {
  'extern-constant.seed': () => {
    reads += 1;
    return BigInt(reads);
  },
};
