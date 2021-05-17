'use strict';

const test = require('ava');
const query = require('../../es/queries');

test('query creates correct string for multiple collectionIds', (t) => {
  const inputQueryParams = {
    _id__in: 'col1___ver1,col1___ver2,col2___ver1',
  };

  const expectedQueryResult =
    '{"query":{"bool":{"must":[{"terms":{"_id":["col1___ver1","col1___ver2","col2___ver1"]}}],"should":[],"must_not":[]}},"sort":[{"timestamp":{"order":"desc"}}]}';

  const actualQueryResult = query(inputQueryParams);

  t.is(JSON.stringify(actualQueryResult), expectedQueryResult);
});
