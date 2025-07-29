'use strict';

const moment = require('moment');
const test = require('ava');
const sinon = require('sinon');

const cryptoRandomString = require('crypto-random-string');

const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  fakeGranuleRecordFactory,
  fakeCollectionRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  FilePgModel,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
} = require('@cumulus/db');

const {
  generateMoveFileParams,
  handleDuplicateFile,
  listVersionedObjects,
  moveGranuleFile,
  renameS3FileWithTimestamp,
  generateUniqueGranuleId,
  unversionFilename,
} = require('../granule');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    testPgCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.beforeEach(async (t) => {
  t.context.internalBucket = randomId('internal-bucket');
  t.context.destBucket = randomId('dest-bucket');
  t.context.testPrefix = cryptoRandomString({ length: 10 });
  t.context.flieName = cryptoRandomString({ length: 10 });
  t.context.key = `${t.context.testPrefix}/${t.context.fileName}`;

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }),
    s3().createBucket({ Bucket: t.context.destBucket }),
  ]);

  const { granulePgModel, filePgModel, internalBucket, key } = t.context;
  const granuleId = cryptoRandomString({ length: 6 });

  const [pgGranule] = await granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory(
      {
        granule_id: granuleId,
        status: 'completed',
        collection_cumulus_id: t.context.collectionCumulusId,
      }
    )
  );
  t.context.pgGranule = pgGranule;
  const granuleCumulusId = pgGranule.cumulus_id;

  const params = { Bucket: internalBucket, Key: key, Body: randomString() };
  await S3.s3PutObject(params);
  await filePgModel.create(t.context.knex, {
    granule_cumulus_id: granuleCumulusId,
    bucket: internalBucket,
    key,
  });
});

test.afterEach(async (t) => {
  await Promise.all([
    S3.recursivelyDeleteS3Bucket(t.context.internalBucket),
    S3.recursivelyDeleteS3Bucket(t.context.destBucket),
  ]);
});

test('generateMoveFileParams generates correct parameters', (t) => {
  const filenames = [
    'included-in-move.txt',
    'another-move.txt',
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath,
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath,
    },
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  moveFileParams.map((item, index) => t.deepEqual(item, {
    file: sourceFiles[index],
    source: {
      Bucket: sourceBucket,
      Key: `origin/${filenames[index]}`,
    },
    target: {
      Bucket: destBucket,
      Key: `${destinationFilepath}/${filenames[index]}`,
    },
  }));
});

test('generateMoveFileParams generates undefined source and target for no destination', (t) => {
  const filenames = [
    'included-in-move.txt',
    'exclude',
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath,
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath,
    },
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  t.deepEqual(moveFileParams[1], { file: sourceFiles[1] });
});

test('renameS3FileWithTimestamp renames file', async (t) => {
  const bucket = t.context.internalBucket;
  const key = `${randomString()}/test.hdf`;
  const params = { Bucket: bucket, Key: key, Body: randomString() };
  await S3.s3PutObject(params);
  // put an existing renamed file
  const formatString = 'YYYYMMDDTHHmmssSSS';
  const existingRenamedKey = `${key}.v${moment.utc().format(formatString)}`;
  const existingRenamedParams = {
    Bucket: bucket, Key: existingRenamedKey, Body: randomString(),
  };
  await S3.s3PutObject(existingRenamedParams);
  await renameS3FileWithTimestamp(bucket, key);
  const renamedFiles = await listVersionedObjects(bucket, key);

  t.is(renamedFiles.length, 2);
  // renamed files have the right prefix
  renamedFiles.map((f) => t.true(f.Key.startsWith(`${key}.v`)));
  // one of the file is the existing renamed file
  t.true(renamedFiles.map((f) => f.Key).includes(existingRenamedKey));
});

test('unversionFilename returns original filename if it has no timestamp', (t) => {
  const noTimeStampFilename = 'somefile.v1';
  const expected = noTimeStampFilename;

  const actual = unversionFilename(noTimeStampFilename);

  t.is(expected, actual);
});

test('unversionFilename returns filename without version stamp if present', (t) => {
  const timeStampedFilename = 'somefile.v20181231T000122333';
  const expected = 'somefile';

  const actual = unversionFilename(timeStampedFilename);

  t.is(expected, actual);
});

test('handleDuplicateFile throws DuplicateFile if method is called and duplicateHandling is set to "error"', async (t) => {
  await t.throwsAsync(handleDuplicateFile({
    duplicateHandling: 'error',
    target: {
      Bucket: 'bar',
      Key: 'foo',
    },
  }), { name: 'DuplicateFile' });
});

test('handleDuplicateFile returns an empty array if duplicateHandling is set to "skip"', async (t) => {
  const actual = await handleDuplicateFile({
    duplicateHandling: 'skip',
  });
  const expected = [];
  t.deepEqual(actual, expected);
});

test('handleDuplicateFile calls moveGranuleFileWithVersioningFunction with expected arguments and returns expected result if duplicateHandling is set to "version" and syncFileFunction/checksum functions are not provided', async (t) => {
  const versionReturn = {
    Bucket: 'VersionedBucket',
    Key: 'VersionedKey',
    size: 0,
  };

  const moveGranuleFileWithVersioningFunctionFake = sinon.fake.returns(versionReturn);

  const actual = await handleDuplicateFile({
    duplicateHandling: 'version',
    fileRemotePath: 'fileRemotePath',
    moveGranuleFileWithVersioningFunction: moveGranuleFileWithVersioningFunctionFake,
    sourceBucket: 'sourceBucket',
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
    source: { Bucket: 'sourceBucket', Key: 'sourceKey' },
  });

  t.deepEqual(actual, versionReturn);
});

test('handleDuplicateFile calls syncFileFunction with expected arguments if duplicateHandling is set to "version" and syncFileFunction is provided', async (t) => {
  const versionReturn = {
    Bucket: 'VersionedBucket',
    Key: 'VersionedKey',
    size: 0,
  };

  const syncFileFake = sinon.fake.returns(true);
  const checksumFunctionFake = sinon.fake.returns(['checksumType', 'checksum']);
  const moveGranuleFileWithVersioningFunctionFake = sinon.fake.returns(versionReturn);

  const actual = await handleDuplicateFile({
    checksumFunction: checksumFunctionFake,
    duplicateHandling: 'version',
    fileRemotePath: 'fileRemotePath',
    moveGranuleFileWithVersioningFunction: moveGranuleFileWithVersioningFunctionFake,
    sourceBucket: 'sourceBucket',
    syncFileFunction: syncFileFake,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
    source: { Bucket: 'sourceBucket', Key: 'sourceKey' },
  });

  t.deepEqual(actual, versionReturn);
  t.deepEqual(
    syncFileFake.getCalls()[0].args[0],
    {
      bucket: 'sourceBucket',
      destinationBucket: 'sourceBucket',
      destinationKey: 'sourceKey',
      fileRemotePath: 'fileRemotePath',
    }
  );
  t.deepEqual(
    checksumFunctionFake.getCalls()[0].args,
    ['sourceBucket', 'sourceKey']
  );
});

test('handleDuplicateFile calls throws if duplicateHandling is set to "version" and checksumFunction throws', async (t) => {
  const syncFileFake = sinon.fake.returns(true);
  const checksumFunctionFake = () => {
    throw new Error('fake test error');
  };
  await t.throwsAsync(() => handleDuplicateFile({
    checksumFunction: checksumFunctionFake,
    duplicateHandling: 'version',
    fileRemotePath: 'fileRemotePath',
    sourceBucket: 'sourceBucket',
    syncFileFunction: syncFileFake,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
    source: { Bucket: 'sourceBucket', Key: 'sourceKey' },
  }));
});

test('handleDuplicateFile calls throws if duplicateHandling is set to "version" and moveGranuleWithVersioningFunction throws', async (t) => {
  const syncFileFake = sinon.fake.returns(true);
  const checksumFunctionFake = sinon.fake.returns(['checksumType', 'checksum']);
  const moveGranuleFileWithVersioningFunctionFake = () => {
    throw new Error('Fake Test Error');
  };
  await t.throwsAsync(() => handleDuplicateFile({
    checksumFunction: checksumFunctionFake,
    duplicateHandling: 'version',
    fileRemotePath: 'fileRemotePath',
    moveGranuleFileWithVersioningFunction: moveGranuleFileWithVersioningFunctionFake,
    sourceBucket: 'sourceBucket',
    syncFileFunction: syncFileFake,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
    source: { Bucket: 'sourceBucket', Key: 'sourceKey' },
  }));
});

test('handleDuplicateFile calls s3.moveObject with expected arguments and returns expected result if duplicateHandling is set to "replace" and syncFileFunction/checksum functions are not provided', async (t) => {
  const moveObjectFake = sinon.fake.returns(true);
  const target = { Bucket: 'targetBucket', Key: 'targetKey' };
  const source = { Bucket: 'sourceBucket', Key: 'sourceKey' };

  const actual = await handleDuplicateFile({
    duplicateHandling: 'replace',
    fileRemotePath: 'fileRemotePath',
    sourceBucket: 'sourceBucket',
    s3Object: { moveObject: moveObjectFake },
    source,
    target,
  });
  const expected = [];
  t.deepEqual(
    moveObjectFake.getCalls()[0].args[0],
    {
      ACL: undefined,
      copyTags: true,
      destinationBucket: target.Bucket,
      destinationKey: target.Key,
      sourceBucket: source.Bucket,
      sourceKey: source.Key,
    }
  );
  t.deepEqual(actual, expected);
});

test('handleDuplicateFile calls syncFileFunction/checksumFunction with expected arguments if duplicateHandling is set to "replace" and syncFileFunction is provided', async (t) => {
  const syncFileFake = sinon.fake.returns(true);
  const checksumFunctionFake = sinon.fake.returns(true);
  const actual = await handleDuplicateFile({
    duplicateHandling: 'replace',
    fileRemotePath: 'fileRemotePath',
    sourceBucket: 'sourceBucket',
    syncFileFunction: syncFileFake,
    checksumFunction: checksumFunctionFake,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
  });

  const expected = [];
  t.deepEqual(actual, expected);
  t.deepEqual(
    syncFileFake.getCalls()[0].args[0],
    {
      bucket: 'sourceBucket',
      destinationBucket: 'targetBucket',
      destinationKey: 'targetKey',
      fileRemotePath: 'fileRemotePath',
    }
  );
  t.deepEqual(
    checksumFunctionFake.getCalls()[0].args,
    ['targetBucket', 'targetKey']
  );
});

test('handleDuplicateFile throws duplicateHandling is set to "replace" and checksumFunction throws', async (t) => {
  const syncFileFake = sinon.fake.returns(true);
  const checksumFunctionFake = () => {
    throw new Error('checksumFailure');
  };
  await t.throwsAsync(handleDuplicateFile({
    duplicateHandling: 'replace',
    fileRemotePath: 'fileRemotePath',
    sourceBucket: 'sourceBucket',
    syncFileFunction: syncFileFake,
    checksumFunction: checksumFunctionFake,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
  }));
});

test('handleDuplicateFile calls S3.moveObject with expected arguments if duplicateHandling is set to "replace" and syncFileFunction is not present', async (t) => {
  const moveObjectSpy = sinon.spy();
  const s3Object = { moveObject: moveObjectSpy };
  const actual = await handleDuplicateFile({
    ACL: 'acl',
    duplicateHandling: 'replace',
    fileRemotePath: 'fileRemotePath',
    sourceBucket: 'sourceBucket',
    s3Object,
    target: { Bucket: 'targetBucket', Key: 'targetKey' },
    source: { Bucket: 'sourceBucket', Key: 'sourceKey' },
  });

  const expected = [];
  t.deepEqual(actual, expected);
  t.deepEqual(
    moveObjectSpy.getCalls()[0].args[0],
    {
      ACL: 'acl',
      copyTags: true,
      destinationBucket: 'targetBucket',
      destinationKey: 'targetKey',
      sourceBucket: 'sourceBucket',
      sourceKey: 'sourceKey',
    }
  );
});

test('moveGranuleFile moves a granule file and updates postgres', async (t) => {
  // Create granule in postgres
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;
  const testPrefix = cryptoRandomString({ length: 10 });
  const fileName = cryptoRandomString({ length: 10 });
  const key = `${testPrefix}/${fileName}`;

  const granulePgModel = new GranulePgModel();
  const filePgModel = new FilePgModel();
  const granuleId = cryptoRandomString({ length: 6 });

  const [pgGranule] = await granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory(
      {
        granule_id: granuleId,
        status: 'completed',
        collection_cumulus_id: t.context.collectionCumulusId,
      }
    )
  );
  const granuleCumulusId = pgGranule.cumulus_id;
  const moveFileParam = {
    source: {
      Bucket: bucket,
      Key: key,
    },
    target: {
      Bucket: secondBucket,
      Key: key,
    },
    file: {
      bucket,
      key,
      name: key,
    },
  };

  const params = { Bucket: bucket, Key: key, Body: randomString() };
  await S3.s3PutObject(params);
  await filePgModel.create(t.context.knex, {
    granule_cumulus_id: granuleCumulusId,
    bucket,
    key,
  });

  const result = await moveGranuleFile(
    moveFileParam,
    filePgModel,
    t.context.knex,
    granuleCumulusId
  );

  t.deepEqual(
    {
      bucket: secondBucket,
      key,
      fileName,
    },
    result
  );

  const listObjectsResponse = await s3().listObjects({
    Bucket: secondBucket,
    Prefix: testPrefix,
  });
  t.is(listObjectsResponse.Contents.length, 1);
  t.is(listObjectsResponse.Contents[0].Key, key);

  const pgFile = await filePgModel.search(t.context.knex, {
    granule_cumulus_id: granuleCumulusId,
    file_name: key,
  });

  t.is(pgFile.length, 1);
  t.like(pgFile[0], {
    bucket: secondBucket,
    key,
  });
});

test('moveGranuleFile throws when writeToPostgres is true but postgresCumulusGranuleId is defined', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;
  const testPrefix = cryptoRandomString({ length: 10 });
  const fileName = cryptoRandomString({ length: 10 });
  const key = `${testPrefix}/${fileName}`;

  const filePgModel = new FilePgModel();

  const moveFileParam = {
    source: {
      Bucket: bucket,
      Key: key,
    },
    target: {
      Bucket: secondBucket,
      Key: key,
    },
    file: {
      bucket,
      key,
      name: key,
    },
  };

  await t.throwsAsync(moveGranuleFile(
    moveFileParam,
    filePgModel,
    t.context.knex,
    undefined,
    true
  ));
});

test('moveGranuleFile returns the expected MovedGranuleFile object if a source and target is missing from the moveFileParams', async (t) => {
  const bucket = t.context.internalBucket;
  const { filePgModel, knex, pgGranule, key } = t.context;

  const moveFileParam = {
    file: {
      bucket,
      key,
      name: key,
    },
  };

  const actual = await moveGranuleFile(
    moveFileParam,
    filePgModel,
    knex,
    pgGranule.cumulus_id
  );

  t.deepEqual(actual, {
    bucket,
    key,
  });
});

test('moveGranuleFile returns the expected MovedGranuleFile object the file only has a filename', async (t) => {
  const { filePgModel, knex, pgGranule, key, internalBucket } = t.context;

  const moveFileParam = {
    file: {
      filename: `s3://${internalBucket}/${key}`,
    },
  };

  const actual = await moveGranuleFile(
    moveFileParam,
    filePgModel,
    knex,
    pgGranule.cumulus_id
  );

  t.deepEqual(actual, {
    bucket: internalBucket,
    key,
  });
});

test('moveGranuleFile throws if the file does not have expected keys and no source or target', async (t) => {
  const { filePgModel, knex, pgGranule } = t.context;

  const moveFileParam = {
    file: {
      foobar: 's3://some/objectPath',
    },
  };

  await t.throwsAsync(moveGranuleFile(
    moveFileParam,
    filePgModel,
    knex,
    pgGranule.cumulus_id
  ));
});

test('generateUniqueGranuleId generates a unique ID with the specified hash length', (t) => {
  const granule = {
    granuleId: 'Az09- éñøæß œüç ΔΩЖЯ あア漢 数据셋 àé',
    collectionId: 'testCollection',
  };

  const hashLength = 8;
  const uniqueId = generateUniqueGranuleId(granule.granuleId, granule.collectionId, hashLength);

  t.true(uniqueId.startsWith(`${granule.granuleId}_`), 'Generated ID should start with granuleId and underscore');
  t.is(uniqueId.split('_')[1].length, hashLength, `Hash length should match the specified length: ${uniqueId}`);
});

test('generateUniqueGranuleId generates different IDs for different timestamps', (t) => {
  const granule = {
    granuleId: 'Az09- éñøæß œüç ΔΩЖЯ あア漢 数据셋 àé',
    collectionId: 'testCollection',
  };

  const uniqueId1 = generateUniqueGranuleId(granule.granuleId, granule.collectionId, 8, true);
  const uniqueId2 = generateUniqueGranuleId(granule.granuleId, granule.collectionId, 8, true);

  t.not(uniqueId1, uniqueId2, 'Generated IDs should be unique due to different timestamps');
});

test('generateUniqueGranuleId generates different length hash for a different hashlength value', (t) => {
  const granule = {
    granuleId: 'Az09- éñøæß œüç ΔΩЖЯ あア漢 数据셋 àé',
    collectionId: 'testCollection',
  };

  const hashLength = 4;
  const uniqueId = generateUniqueGranuleId(granule.granuleId, granule.collectionId, hashLength);
  t.is(uniqueId.split('_')[1].length, hashLength, `Hash length should match the specified length: ${uniqueId}`);
});
