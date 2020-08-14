const test = require('ava');
const { createCollection } = require('..');

test('createCollection', async (t) => {
  await t.notThrowsAsync(createCollection({
    name: 'foo',
    version: '2',
  }));
});
