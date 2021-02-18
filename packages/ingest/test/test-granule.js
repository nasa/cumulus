'use strict';

const moment = require('moment');
const test = require('ava');
const sinon = require('sinon');

const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  generateMoveFileParams,
  handleDuplicateFile,
  listVersionedObjects,
  moveGranuleFiles,
  renameS3FileWithTimestamp,
  unversionFilename,
} = require('../granule');

test.beforeEach(async (t) => {
  t.context.internalBucket = randomId('internal-bucket');
  t.context.destBucket = randomId('dest-bucket');

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }).promise(),
    s3().createBucket({ Bucket: t.context.destBucket }).promise(),
  ]);
});

test.afterEach(async (t) => {
  await Promise.all([
    S3.recursivelyDeleteS3Bucket(t.context.internalBucket),
    S3.recursivelyDeleteS3Bucket(t.context.destBucket),
  ]);
});

test('moveGranuleFiles moves granule files between s3 locations', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg',
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath),
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath,
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath,
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath,
    },
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);

  // ACT
  await moveGranuleFiles(sourceFiles, destinations);

  // ASSERT
  const listObjectsResponse = await s3().listObjects({
    Bucket: bucket,
  }).promise();

  t.is(listObjectsResponse.Contents.length, 2);

  t.true(listObjectsResponse.Contents[0].Key.startsWith(destinationFilepath));
  t.true(listObjectsResponse.Contents[1].Key.startsWith(destinationFilepath));

  const secondListObjectsResponse = await s3().listObjects({
    Bucket: secondBucket,
  }).promise();

  t.is((secondListObjectsResponse).Contents.length, 1);

  t.true(
    secondListObjectsResponse.Contents[0].Key.startsWith(destinationFilepath)
  );
});

test('moveGranuleFiles only moves granule files specified with regex', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'included-in-move.txt',
    'excluded-from-move',
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath),
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: secondBucket,
      filepath: destinationFilepath,
    },
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);
  await moveGranuleFiles(sourceFiles, destinations);

  const bucketListResponse = await s3().listObjects({
    Bucket: bucket,
  }).promise();

  t.is(bucketListResponse.Contents.length, 1);

  t.is(bucketListResponse.Contents[0].Key, 'origin/excluded-from-move');

  const secondBucketListResponse = await s3().listObjects({
    Bucket: secondBucket,
  }).promise();

  t.is(secondBucketListResponse.Contents.length, 1);

  t.is(secondBucketListResponse.Contents[0].Key, 'destination/included-in-move.txt');
});

test('moveGranuleFiles returns an updated list of files in their new locations.', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg',
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath),
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath,
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath,
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath,
    },
  ];

  const expectedUpdatedFiles = [
    {
      name: 'test-one.txt',
      bucket: bucket,
      key: 'destination/test-one.txt',
    },
    {
      name: 'test-two.md',
      bucket: bucket,
      key: 'destination/test-two.md',
    },
    {
      name: 'test-three.jpg',
      bucket: secondBucket,
      key: 'destination/test-three.jpg',
    },
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);

  // ACT
  const updatedFiles = await moveGranuleFiles(sourceFiles, destinations);

  expectedUpdatedFiles.forEach((expected) => {
    const updatedFile = updatedFiles.find(
      (file) =>
        file.bucket === expected.bucket
        && file.key === expected.key
    );
    t.deepEqual(updatedFile, expected);
  });
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

test('handleDuplicateFile calls syncFileFunction with expected arguments if duplicateHandling is set to "replace" and syncFileFunction is provided', async (t) => {
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
