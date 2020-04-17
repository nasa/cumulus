'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const differenceWith = require('lodash/differenceWith');
const pMap = require('p-map');
const GranuleFilesCache = require('../lib/GranuleFilesCache');

const handleInsert = (record) => {
  const { files, granuleId } = attr.unwrap(record.dynamodb.NewImage);
  return GranuleFilesCache.batchUpdate({
    puts: files.map((file) => ({ ...file, granuleId }))
  });
};

const handleModify = (record) => {
  const newGranule = attr.unwrap(record.dynamodb.NewImage);

  const newGranuleFiles = newGranule.files
    .map((file) => ({ ...file, granuleId: newGranule.granuleId }));

  const deletes = differenceWith(
    attr.unwrap(record.dynamodb.OldImage).files,
    newGranuleFiles,
    (x, y) => x.bucket === y.bucket && x.key === y.key
  );

  return GranuleFilesCache.batchUpdate({ deletes, puts: newGranuleFiles });
};

const handleRemove = (record) => {
  const deletes = attr.unwrap(record.dynamodb.OldImage).files;
  return GranuleFilesCache.batchUpdate({ deletes });
};

const updateCache = (record) => {
  if (record.eventName === 'INSERT') return handleInsert(record);
  if (record.eventName === 'MODIFY') return handleModify(record);
  if (record.eventName === 'REMOVE') return handleRemove(record);
  throw new Error(`Unable to process record: ${JSON.stringify(record)}`);
};

module.exports = {
  // eslint-disable-next-line no-console
  handler: async ({ Records }) => pMap(Records, updateCache).catch(console.log)
};
