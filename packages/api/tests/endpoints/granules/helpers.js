const {
  translateApiGranuleToPostgresGranule,
  translateApiFiletoPostgresFile,
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
    createPostgresEntries = true,
  } = params;
  const newGranule = fakeGranuleFactoryV2({ collectionId: t.context.collectionId });
  newGranule.files = [
    fakeFileFactory({
      bucket,
      fileName: `${granuleFileName}.txt`,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.txt`,
      source: 'fakeSource',
      size: 9,
    }),
    fakeFileFactory({
      bucket,
      fileName: `${granuleFileName}.md`,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.md`,
      source: 'fakeSource',
      size: 9,
    }),
    fakeFileFactory({
      bucket: secondBucket,
      fileName: `${granuleFileName}.jpg`,
      key: `${process.env.stackName}/original_filepath/${granuleFileName}.jpg`,
      source: 'fakeSource',
      size: 9,
    }),
  ];

  await granuleModel.create(newGranule);

  let postgresNewGranule;
  let postgresGranuleCumulusId;
  if (createPostgresEntries) {
    postgresNewGranule = await translateApiGranuleToPostgresGranule(
      newGranule,
      t.context.knex
    );
    postgresNewGranule.collection_cumulus_id = t.context.collectionCumulusId;

    [postgresGranuleCumulusId] = await granulePgModel.create(
      t.context.knex, postgresNewGranule
    );
    const postgresNewGranuleFiles = newGranule.files.map((file) => {
      const translatedFile = translateApiFiletoPostgresFile(file);
      translatedFile.granule_cumulus_id = postgresGranuleCumulusId;
      return translatedFile;
    });
    await Promise.all(
      postgresNewGranuleFiles.map((file) =>
        filePgModel.create(t.context.knex, file))
    );
  }

  await Promise.all(
    newGranule.files.map(
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

  return { newGranule, postgresNewGranule, postgresGranuleCumulusId };
};

module.exports = {
  generateMoveGranuleTestFilesAndEntries,
  getPostgresFilesInOrder,
};
