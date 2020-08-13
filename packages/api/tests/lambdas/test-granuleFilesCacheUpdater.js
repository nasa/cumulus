'use strict';

const test = require('ava');
const attr = require('dynamodb-data-types').AttributeValue;
const { randomString } = require('@cumulus/common/test-utils');
const { noop } = require('@cumulus/common/util');
const GranuleFilesCache = require('../../lib/GranuleFilesCache');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { handler } = require('../../lambdas/granuleFilesCacheUpdater');

test.before(async () => {
  process.env.FilesTable = randomString();
  await GranuleFilesCache.createCacheTable();
});

test.after.always(async () => {
  await GranuleFilesCache.deleteCacheTable().catch(noop);
});

test('A granule insert event adds files to the granule files cache', async (t) => {
  const file = { bucket: randomString(), key: randomString() };

  const granule = fakeGranuleFactoryV2({ files: [file] });

  const event = {
    Records: [
      {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: attr.wrap(granule),
        },
      },
    ],
  };

  await handler(event);

  t.is(
    await GranuleFilesCache.getGranuleId(file.bucket, file.key),
    granule.granuleId
  );
});

test('A granule modify event adds additional files to the granule files cache', async (t) => {
  const granuleId = randomString();

  // Add the previously-inserted granule file to the cache. This would have
  // happened when the granule was first created.
  const originalFile = { bucket: randomString(), key: randomString() };
  await GranuleFilesCache.put({ ...originalFile, granuleId });

  const originalGranule = fakeGranuleFactoryV2({
    granuleId,
    files: [originalFile],
  });

  const newFile = { bucket: randomString(), key: randomString() };

  const newGranule = {
    ...originalGranule,
    files: [
      originalFile,
      newFile,
    ],
  };

  const event = {
    Records: [
      {
        eventName: 'MODIFY',
        dynamodb: {
          NewImage: attr.wrap(newGranule),
          OldImage: attr.wrap(originalGranule),
        },
      },
    ],
  };

  await handler(event);

  t.is(
    await GranuleFilesCache.getGranuleId(originalFile.bucket, originalFile.key),
    granuleId
  );

  t.is(
    await GranuleFilesCache.getGranuleId(newFile.bucket, newFile.key),
    granuleId
  );
});

test('A granule modify event can remove files from the granule files cache', async (t) => {
  const granuleId = randomString();

  // Stage two files to the granule files cache, as if the originally inserted
  // granule contained two files
  const file1 = { bucket: randomString(), key: randomString() };
  await GranuleFilesCache.put({ ...file1, granuleId });

  const file2 = { bucket: randomString(), key: randomString() };
  await GranuleFilesCache.put({ ...file2, granuleId });

  // Create an event where the original granule had two files, but the new
  // granule only has one file.
  const originalGranule = fakeGranuleFactoryV2({
    granuleId,
    files: [file1, file2],
  });

  const newGranule = { ...originalGranule, files: [file1] };

  const event = {
    Records: [
      {
        eventName: 'MODIFY',
        dynamodb: {
          NewImage: attr.wrap(newGranule),
          OldImage: attr.wrap(originalGranule),
        },
      },
    ],
  };

  await handler(event);

  t.is(
    await GranuleFilesCache.getGranuleId(file1.bucket, file1.key),
    granuleId
  );

  t.is(await GranuleFilesCache.getGranuleId(file2.bucket, file2.key), undefined);
});

test("A granule delete remove event removes the granule's files from the cache", async (t) => {
  const granuleId = randomString();

  // Add the previously-inserted granule file to the cache. This would have
  // happened when the granule was first created.
  const file = { bucket: randomString(), key: randomString() };
  await GranuleFilesCache.put({ ...file, granuleId });

  const originalGranule = fakeGranuleFactoryV2({
    granuleId,
    files: [file],
  });

  const event = {
    Records: [
      {
        eventName: 'REMOVE',
        dynamodb: {
          OldImage: attr.wrap(originalGranule),
        },
      },
    ],
  };

  await handler(event);

  t.is(await GranuleFilesCache.getGranuleId(file.bucket, file.key), undefined);
});
