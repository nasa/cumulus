const test = require('ava');
const { removeNilProperties } = require('@cumulus/common/util');
const { translateApiCollectionToPostgresCollection } = require('../dist/collections');

test('translateApiCollectionToPostgresCollection converts API collection to Postgres', (t) => {
  const apiCollection = {
    name: 'COLL',
    version: '001',
    granuleIdExtraction: '.*',
    granuleId: '.*',
    files: [
      {
        bucket: 's3-bucket',
        regex: '.*',
        sampleFileName: 'somefilename',
      },
    ],
  };

  const expectedPostgresCollection = {
    name: apiCollection.name,
    version: apiCollection.version,
    granule_id_validation_regex: apiCollection.granuleId,
    granule_id_extraction_regex: apiCollection.granuleIdExtraction,
    files: JSON.stringify(apiCollection.files),
  };

  t.deepEqual(
    removeNilProperties(translateApiCollectionToPostgresCollection(apiCollection)),
    expectedPostgresCollection
  );
});
