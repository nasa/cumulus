const path = require('path');
const test = require('ava');

const { getObject } = require('../S3');
const { s3 } = require('../services');

test('better stack traces', async (t) => {
  const f = () => getObject(s3(), { Bucket: 'asdf', Key: 'jkl;' });
  const g = () => f();
  const h = () => g();

  try {
    await t.throwsAsync(h, { message: /The specified bucket does not exist/ });
  } catch (error) {
    t.true(error.stack.includes(path.basename(__filename)));
  }
});
