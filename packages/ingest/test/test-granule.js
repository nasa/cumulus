'use strict';

const moment = require('moment');
const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  generateMoveFileParams,
  getRenamedS3File,
  moveGranuleFiles,
  moveGranuleFile,
  renameS3FileWithTimestamp,
  unversionFilename
} = require('../granule');

test.beforeEach(async (t) => {
  t.context.internalBucket = randomId('internal-bucket');
  t.context.destBucket = randomId('dest-bucket');

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }).promise(),
    s3().createBucket({ Bucket: t.context.destBucket }).promise()
  ]);
});

test.afterEach(async (t) => {
  await Promise.all([
    S3.recursivelyDeleteS3Bucket(t.context.internalBucket),
    S3.recursivelyDeleteS3Bucket(t.context.destBucket)
  ]);
});

test('moveGranuleFile moves a single file between s3 locations', async (t) => {
  const Bucket = t.context.internalBucket;

  const name = 'test.txt';
  const Key = `origin/${name}`;
  const params = { Bucket, Key, Body: 'test' };
  await S3.s3PutObject(params);

  const source = { Bucket, Key };
  const target = { Bucket, Key: `moved/${name}` };

  await moveGranuleFile(source, target);
  return s3().listObjects({ Bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);

    const item = list.Contents[0];
    t.is(item.Key, `moved/${name}`);
  });
});

test('moveGranuleFile overwrites existing file by default', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;

  const name = 'test.txt';
  const Key = `origin/${name}`;

  // Pre-stage destination file
  await S3.s3PutObject({ Bucket: destBucket, Key, Body: 'initialBody' });

  // Stage source file
  const updatedBody = randomId('updatedBody');
  const params = { Bucket: sourceBucket, Key, Body: updatedBody };
  await S3.s3PutObject(params);

  const source = { Bucket: sourceBucket, Key };
  const target = { Bucket: destBucket, Key };

  try {
    await moveGranuleFile(source, target);
  } catch (error) {
    t.fail();
  } finally {
    const objects = await s3().listObjects({ Bucket: destBucket }).promise();
    t.is(objects.Contents.length, 1);

    const item = objects.Contents[0];
    t.is(item.Key, Key);

    t.is(item.Size, updatedBody.length);
  }
});

test('moveGranuleFiles moves granule files between s3 locations', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);

  // ACT
  await moveGranuleFiles(sourceFiles, destinations);

  // ASSERT
  await s3().listObjects({ Bucket: bucket }).promise().then((list) => {
    t.is(list.Contents.length, 2);

    list.Contents.forEach((item) => {
      t.is(item.Key.indexOf(destinationFilepath), 0);
    });
  });

  return s3().listObjects({ Bucket: secondBucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);

    list.Contents.forEach((item) => {
      t.is(item.Key.indexOf(destinationFilepath), 0);
    });
  });
});

test('moveGranuleFiles only moves granule files specified with regex', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'included-in-move.txt',
    'excluded-from-move'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);
  await moveGranuleFiles(sourceFiles, destinations);

  await s3().listObjects({ Bucket: bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'origin/excluded-from-move');
  });

  return s3().listObjects({ Bucket: secondBucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'destination/included-in-move.txt');
  });
});

test('moveGranuleFiles returns an updated list of files in their new locations.', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await S3.s3PutObject(params);
    return {
      name,
      bucket,
      key: sourcefilePath,
      filename: S3.buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const expectedUpdatedFiles = [
    {
      name: 'test-one.txt',
      bucket: bucket,
      key: 'destination/test-one.txt'
    },
    {
      name: 'test-two.md',
      bucket: bucket,
      key: 'destination/test-two.md'
    },
    {
      name: 'test-three.jpg',
      bucket: secondBucket,
      key: 'destination/test-three.jpg'
    }
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
    'another-move.txt'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath
    }
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  moveFileParams.map((item, index) => t.deepEqual(item, {
    file: sourceFiles[index],
    source: {
      Bucket: sourceBucket,
      Key: `origin/${filenames[index]}`
    },
    target: {
      Bucket: destBucket,
      Key: `${destinationFilepath}/${filenames[index]}`
    }
  }));
});

test('generateMoveFileParams generates null source and target for no destination', (t) => {
  const filenames = [
    'included-in-move.txt',
    'exclude'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath
    }
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  t.deepEqual(moveFileParams[1], {
    file: sourceFiles[1],
    source: null,
    target: null
  });
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
    Bucket: bucket, Key: existingRenamedKey, Body: randomString()
  };
  await S3.s3PutObject(existingRenamedParams);
  await renameS3FileWithTimestamp(bucket, key);
  const renamedFiles = await getRenamedS3File(bucket, key);

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
