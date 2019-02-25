'use strict';

const test = require('ava');

const {
  dynamodbDocClient,
  s3,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const { Manager, Granule } = require('../../models');
const {
  fakeFileFactory,
  fakeGranuleFactoryV2
} = require('../../lib/testUtils');

let manager;
test.before(async () => {
  process.env.GranulesTable = randomString();

  manager = new Manager({
    tableName: process.env.GranulesTable,
    tableHash: { name: 'granuleId', type: 'S' }
  });

  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('files existing at location returns empty array if no files exist', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map(
    (name) =>
      fakeFileFactory({
        name,
        bucket: sourceBucket,
        key: `origin/${name}`
      })
  );

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      key: destinationFilepath
    }
  ];

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, []);
});

test('files existing at location returns both files if both exist', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await s3().createBucket({ Bucket: destBucket }).promise();

  const sourceFiles = filenames.map(
    (fileName) => fakeFileFactory({ fileName, bucket: sourceBucket })
  );

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket
    }
  ];

  const dataSetupPromises = filenames.map(async (filename) => {
    const params = {
      Bucket: destBucket,
      Key: filename,
      Body: 'test'
    };
    return s3().putObject(params).promise();
  });

  await Promise.all(dataSetupPromises);

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists', async (t) => {
  const filenames = [
    'granule-file-1.hdf',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await s3().createBucket({ Bucket: destBucket }).promise();

  const sourceFiles = filenames.map(
    (fileName) => fakeFileFactory({ fileName, bucket: sourceBucket })
  );

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      filepath: ''
    }
  ];

  const params = {
    Bucket: destBucket,
    Key: filenames[1],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, [sourceFiles[1]]);

  await recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists with multiple destinations', async (t) => {
  const filenames = [
    'granule-file-1.txt',
    'granule-file-2.hdf'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket1 = randomString();
  const destBucket2 = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: destBucket1 }).promise(),
    s3().createBucket({ Bucket: destBucket2 }).promise()
  ]);

  const sourceFiles = filenames.map(
    (fileName) => fakeFileFactory({ fileName, bucket: sourceBucket })
  );

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket1,
      filepath: ''
    },
    {
      regex: '.*.hdf$',
      bucket: destBucket2,
      filepath: ''
    }
  ];

  let params = {
    Bucket: destBucket1,
    Key: filenames[0],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  params = {
    Bucket: destBucket2,
    Key: filenames[1],
    Body: 'test'
  };
  await s3().putObject(params).promise();

  const granule = {
    files: sourceFiles
  };

  const granulesModel = new Granule();

  const filesExisting = await granulesModel.getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await Promise.all([
    recursivelyDeleteS3Bucket(destBucket1),
    recursivelyDeleteS3Bucket(destBucket2)
  ]);
});

test('get() will translate an old-style granule file into the new schema', async (t) => {
  const oldFile = {
    bucket: 'my-bucket',
    filename: 's3://my-bucket/path/to/file.txt',
    filepath: 'path/to/file.txt',
    name: 'file123.txt',
    path: 'source/path',
    checksumType: 'my-checksumType',
    checksumValue: 'my-checksumValue',
    url_path: 'some-url-path',
    fileSize: 1234
  };

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule
  }).promise();

  const granuleModel = new Granule();
  const fetchedGranule = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      fileSize: 1234
    }
  );
});

test('get() will correctly return a granule file stored using the new schema', async (t) => {
  const newFile = {
    bucket: 'my-bucket',
    key: 'path/to/file.txt',
    fileName: 'file123.txt',
    checksumType: 'my-checksumType',
    checksum: 'my-checksumValue',
    fileSize: 1234
  };

  const granule = fakeGranuleFactoryV2({ files: [newFile] });

  await dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule
  }).promise();

  const granuleModel = new Granule();
  const fetchedGranule = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      fileSize: 1234
    }
  );
});

test('batchGet() will translate old-style granule files into the new schema', async (t) => {
  const oldFile = {
    bucket: 'my-bucket',
    filename: 's3://my-bucket/path/to/file.txt',
    filepath: 'path/to/file.txt',
    name: 'file123.txt',
    path: 'source/path',
    checksumType: 'my-checksumType',
    checksumValue: 'my-checksumValue',
    url_path: 'some-url-path',
    fileSize: 1234
  };

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule
  }).promise();

  const granuleModel = new Granule();
  const batchGetResponse = await granuleModel.batchGet([
    { granuleId: granule.granuleId }
  ]);

  const fetchedGranule = batchGetResponse.Responses[process.env.GranulesTable][0];

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      fileSize: 1234
    }
  );
});

test('scan() will translate old-style granule files into the new schema', async (t) => {
  const oldFile = {
    bucket: 'my-bucket',
    filename: 's3://my-bucket/path/to/file.txt',
    filepath: 'path/to/file.txt',
    name: 'file123.txt',
    path: 'source/path',
    checksumType: 'my-checksumType',
    checksumValue: 'my-checksumValue',
    url_path: 'some-url-path',
    fileSize: 1234
  };

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule
  }).promise();

  const granuleModel = new Granule();
  const scanResponse = await granuleModel.scan();

  t.deepEqual(
    scanResponse.Items[0].files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      fileSize: 1234
    }
  );
});
