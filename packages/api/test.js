'use strict';
import test from 'ava';

const kinesisConsumer = require('./lambdas/kinesis-consumer');

test('arrays are equal', t => {
  t.deepEqual([1, 2], [1, 2]);
});
