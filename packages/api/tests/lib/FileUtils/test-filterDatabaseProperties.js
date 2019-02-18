'use strict';

const test = require('ava');
const { filterDatabaseProperties } = require('../../../lib/FileUtils');

test('filterDatabaseProperties() returns only those properties that belong in the database', (t) => {
  const file = {
    a: 1,
    b: 2,
    bucket: 'my-bucket'
  };

  t.deepEqual(
    filterDatabaseProperties(file),
    {
      bucket: 'my-bucket'
    }
  );
});
