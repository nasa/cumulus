const test = require('ava');
const { removeNilProperties } = require('@cumulus/common/util');
const {
  translateApiCollectionToPostgresCollection,
  translatePostgresCollectionToApiCollection,
} = require('../../dist/translate/collections');
const {
  fakeCollectionRecordFactory,
} = require('../../dist/test-utils');

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

test('translatePostgresCollectionToApiCollection converts Postgres collection to API', (t) => {
  const extraParams = {
    process: 'test-process',
    duplicateHandling: 'replace',
    reportToEms: false,
    ignoreFilesConfigForDiscovery: false,
    meta: JSON.stringify({
      foo: 'bar',
    }),
    tags: JSON.stringify(['tag1', 'tag2']),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const collectionPgRecord = fakeCollectionRecordFactory(extraParams);
  t.deepEqual(
    translatePostgresCollectionToApiCollection(collectionPgRecord),
    {
      name: collectionPgRecord.name,
      version: collectionPgRecord.version,
      process: collectionPgRecord.process,
      url_path: collectionPgRecord.url_path,
      duplicateHandling: collectionPgRecord.duplicate_handling,
      granuleId: collectionPgRecord.granule_id_validation_regex,
      granuleIdExtraction: collectionPgRecord.granule_id_extraction_regex,
      files: JSON.parse(collectionPgRecord.files),
      reportToEms: collectionPgRecord.report_to_ems,
      sampleFileName: collectionPgRecord.sample_file_name,
      ignoreFilesConfigForDiscovery: collectionPgRecord.ignore_files_config_for_discovery,
      meta: JSON.parse(collectionPgRecord.meta),
      tags: JSON.parse(collectionPgRecord.tags),
      createdAt: collectionPgRecord.created_at.getTime(),
      updatedAt: collectionPgRecord.updated_at.getTime(),
    }
  );
});

test('translatePostgresCollectionToApiCollection handles optional fields', (t) => {
  const collectionPgRecord = fakeCollectionRecordFactory();

  t.deepEqual(
    translatePostgresCollectionToApiCollection(collectionPgRecord),
    {
      name: collectionPgRecord.name,
      version: collectionPgRecord.version,
      granuleId: collectionPgRecord.granule_id_validation_regex,
      granuleIdExtraction: collectionPgRecord.granule_id_extraction_regex,
      files: JSON.parse(collectionPgRecord.files),
      sampleFileName: collectionPgRecord.sample_file_name,
      duplicateHandling: undefined,
      reportToEms: undefined,
      process: undefined,
      url_path: undefined,
      ignoreFilesConfigForDiscovery: undefined,
      meta: undefined,
      tags: undefined,
    }
  );
});
