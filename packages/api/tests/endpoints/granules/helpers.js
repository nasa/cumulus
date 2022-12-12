const {
  translatePostgresGranuleToApiGranule,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');

const {
  putJsonS3Object,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const { getBucketsConfigKey } = require('@cumulus/common/stack');

const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');

const getPgFilesFromGranuleCumulusId = async (knex, filePgModel, postgresGranuleCumulusId) =>
  await filePgModel.search(knex, {
    granule_cumulus_id: postgresGranuleCumulusId,
  });

const getFileNameFromKey = (key) => key.split('/').pop();

const generateMoveGranuleTestFilesAndEntries = async (params) => {
  const {
    t,
    bucket,
    secondBucket,
    filePgModel,
    granulePgModel,
    granuleFileName,
  } = params;

  const fakePgGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  });

  const [upsertedPgGranule] = await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: t.context.knex,
    granule: fakePgGranule,
    executionCumulusId: t.context.testExecutionCumulusId,
  });
  const postgresGranuleCumulusId = upsertedPgGranule.cumulus_id;

  const pgGranule = await granulePgModel.get(
    t.context.knex,
    { cumulus_id: postgresGranuleCumulusId }
  );

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
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: t.context.knex,
  });

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
  getFileNameFromKey,
  getPgFilesFromGranuleCumulusId,
};
