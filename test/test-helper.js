'use strict';

/**
 * Partitions an array into even sets of n items. The last set may contain less than n.
 */
const partition = (n, items) => {
  if (n >= items.length) {
    return [items];
  }
  return [items.slice(0, n)].concat(partition(n, items.slice(n)));
};

/**
 * Allows testing a bunch of different examples with expected values
 * @param tester a function that will perform assertions taking args and expected
 * @param examples alternating triples of a name to describe the example, input args, and the
 * expected result.
 */
const withNamedExamples = (tester, ...examples) => {
  const exampleSets = partition(3, examples);
  exampleSets.map(([name, args, expected]) =>
    it(name, () => tester(args, expected))
  );
};

/**
 * Allows testing a bunch of different examples with expected values
 * @param tester a function that will perform assertions taking args and expected
 * @param examples alternating pairs of input args and the expected result.
 */
const withExamples = (tester, ...examples) => {
  const exampleSets = partition(2, examples);
  exampleSets.map(([args, expected]) =>
    tester(args, expected)
  );
};

module.exports = { withNamedExamples, withExamples };
