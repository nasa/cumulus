const {
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
  translateApiFiletoPostgresFile,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  fakeExecutionRecordFactory,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');

const {
  putJsonS3Object,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const { getBucketsConfigKey } = require('@cumulus/common/stack');

const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');

const {
  fakeFileFactory,
  fakeGranuleFactoryV2,
} = require('../../../lib/testUtils');

const getPostgresFilesInOrder = async (knex, newGranule, filePgModel, postgresGranuleCumulusId) => {
  const pgFiles = await Promise.all(newGranule.files.map(async (file) => {
    const [pgFile] = await filePgModel.search(knex, {
      granule_cumulus_id: postgresGranuleCumulusId,
      file_name: file.fileName,
    });
    return pgFile;
  }));
  return pgFiles;
};

const generateMoveGranuleTestFilesAndEntries = async (params) => {
  const {
    t,
    bucket,
    secondBucket,
    granulePgModel,
    filePgModel,
    granuleModel,
    granuleFileName,
  } = params;
  const pgGranule = fakeGranuleRecordFactory({ collection_cumulus_id: t.context.collectionCumulusId});
  const [postgresGranuleCumulusId] = await upsertGranuleWithExecutionJoinRecord(t.context.knex, pgGranule, t.context.testExecutionCumulusId);
  const pgFiles = [
    fakeFileRecordFactory({
      bucket,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.txt`,
      source: 'fakeSource',
      file_size: 9,
      granule_cumulus_id: postgresGranuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.md`,
      source: 'fakeSource',
      file_size: 9,
      granule_cumulus_id: postgresGranuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket: secondBucket,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.jpg`,
      source: 'fakeSource',
      file_size: 9,
      granule_cumulus_id: postgresGranuleCumulusId,
    }),
  ];
  await Promise.all(pgFiles.map((file) => filePgModel.create(t.context.knex, file)));
  const apiGranule = await translatePostgresGranuleToApiGranule(
    {
      cumulus_id: postgresGranuleCumulusId,
      ...pgGranule,
    },
    t.context.knex
  );
  await granuleModel.create(apiGranule);

  await Promise.all(
    apiGranule.files.map(
      (file) =>
        s3PutObject({
          Bucket: file.bucket,
          Key: file.key,
          Body: 'test data',
        })
    )
  );

  await putJsonS3Object(
    process.env.system_bucket,
    getBucketsConfigKey(process.env.stackName),
    {}
  );

  await putJsonS3Object(
    process.env.system_bucket,
    getDistributionBucketMapKey(process.env.stackName),
    {}
  );

  return { newGranule: apiGranule, postgresNewGranule: pgGranule, postgresGranuleCumulusId };
};

module.exports = {
  generateMoveGranuleTestFilesAndEntries,
  getPostgresFilesInOrder,
};
