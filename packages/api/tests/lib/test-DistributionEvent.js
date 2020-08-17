'ust strict';

const test = require('ava');
const pMap = require('p-map');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const Granule = require('../../models/granules');
const DistributionEvent = require('../../lib/DistributionEvent');
const {
  fakeGranuleFactoryV2,
  fakeFileFactory,
} = require('../../lib/testUtils');
const GranuleFilesCache = require('../../lib/GranuleFilesCache');

const createGranule = async (granule) => {
  await (new Granule()).create(granule);

  await pMap(
    granule.files,
    async ({ bucket, key }) => {
      await GranuleFilesCache.put({ bucket, key, granuleId: granule.granuleId });
      await s3PutObject({ Bucket: bucket, Key: key, Body: 'asdf' });
    }
  );
};

test.before(async (t) => {
  process.env.FilesTable = randomString();
  await GranuleFilesCache.createCacheTable();

  process.env.GranulesTable = randomString();
  await (new Granule()).createTable();

  t.context.publicBucket = randomString();
  await createBucket(t.context.publicBucket);

  t.context.protectedBucket = randomString();
  await createBucket(t.context.protectedBucket);

  t.context.fakeIP = '192.0.2.5';
  t.context.username = randomString();
  t.context.authDownloadLogLine = 'fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e '
    + `${t.context.protectedBucket} [24/Feb/2020:15:05:51 +0000] `
    + '192.0.2.3 arn:aws:sts::XXXXXXXX:assumed-role/DownloadRoleLocal '
    + '30E6BC41DB11A8CE REST.GET.OBJECT '
    + 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met '
    + `"GET /files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met?A-userid=${t.context.username} `
    + 'HTTP/1.1" 200 - 21708 21708 28 27 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:73.0) '
    + 'Gecko/20100101 Firefox/73.0" - k0f1eqG9dkjCcPtRsuZRXNFyNAqpXANK/GFJz9C+fKUiH2V4+O6HcUCdKZlL3XOhH5BZ/UJMqEU='
    + `SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString ${t.context.protectedBucket}.s3.amazonaws.com TLSv1.2`;
  t.context.noAuthDownloadLogLine = 'fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e '
    + `${t.context.publicBucket} [24/Feb/2020:21:45:37 +0000] `
    + '192.0.2.3 arn:aws:sts::XXXXXXXX:assumed-role/DownloadRoleLocal '
    + '30E6BC41DB11A8CE REST.GET.OBJECT '
    + 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf '
    + '"GET /files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf?A-userid=None '
    + 'HTTP/1.1" 200 - 21708 21708 28 27 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:73.0) '
    + 'Gecko/20100101 Firefox/73.0" - k0f1eqG9dkjCcPtRsuZRXNFyNAqpXANK/GFJz9C+fKUiH2V4+O6HcUCdKZlL3XOhH5BZ/UJMqEU='
    + `SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString ${t.context.publicBucket}.s3.amazonaws.com TLSv1.2`;
  t.context.proxyDownloadLogLine = 'fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e '
    + `${t.context.protectedBucket} [24/Feb/2020:15:05:51 +0000] `
    + '192.0.2.3 arn:aws:sts::XXXXXXXX:assumed-role/DownloadRoleLocal '
    + '30E6BC41DB11A8CE REST.GET.OBJECT '
    + 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met '
    + `"GET /files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met?A-userid=${t.context.username}&A-sourceip=${t.context.fakeIP} `
    + 'HTTP/1.1" 200 - 21708 21708 28 27 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:73.0) '
    + 'Gecko/20100101 Firefox/73.0" - k0f1eqG9dkjCcPtRsuZRXNFyNAqpXANK/GFJz9C+fKUiH2V4+O6HcUCdKZlL3XOhH5BZ/UJMqEU='
    + `SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString ${t.context.protectedBucket}.s3.amazonaws.com TLSv1.2`;

  t.context.hdfGranule = fakeGranuleFactoryV2({
    collectionId: 'MOD09GQ___001',
    files: [
      fakeFileFactory({
        bucket: t.context.publicBucket,
        key: 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        type: 'data',
      }),
    ],
  });

  await createGranule(t.context.hdfGranule);

  t.context.metadataGranule = fakeGranuleFactoryV2({
    collectionId: 'MOD09GQ___001',
    files: [
      fakeFileFactory({
        bucket: t.context.protectedBucket,
        key: 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        type: 'metadata',
      }),
    ],
  });

  await createGranule(t.context.metadataGranule);
});

test.after.always(async (t) => {
  await GranuleFilesCache.deleteCacheTable();
  await (new Granule()).deleteTable();
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
});

test('DistributionEvent.isDistributionEvent() returns false for non distribution event', (t) => {
  t.false(DistributionEvent.isDistributionEvent('testing'));
  t.false(DistributionEvent.isDistributionEvent('REST.GET.OBJECT'));
  t.false(DistributionEvent.isDistributionEvent('A-userid=test'));
});

test('DistributionEvent.isDistributionEvent() returns true for distribution event', (t) => {
  t.true(DistributionEvent.isDistributionEvent('REST.GET.OBJECT A-userid=test'));
  t.true(DistributionEvent.isDistributionEvent(t.context.authDownloadLogLine));
  t.true(DistributionEvent.isDistributionEvent(t.context.noAuthDownloadLogLine));
  t.true(DistributionEvent.isDistributionEvent(t.context.proxyDownloadLogLine));
});

test('DistributionEvent.getRequestUrlObject() returns correct parsed URL', async (t) => {
  const distributionEvent = new DistributionEvent(
    'REST.GET.OBJECT "GET /path/to/a/file.hdf?A-userid=test"'
  );
  const urlObject = distributionEvent.getRequestUrlObject();
  t.is(
    urlObject.toString(),
    'http://localhost/path/to/a/file.hdf?A-userid=test'
  );
});

test('DistributionEvent.getRequestQueryParamValue() returns correct value', async (t) => {
  const distributionEvent = new DistributionEvent(
    'REST.GET.OBJECT "GET /test?A-userid=test&foo=bar"'
  );
  const queryParam = distributionEvent.getRequestQueryParamValue('foo');
  t.is(queryParam, 'bar');
});

test('DistributionEvent.username returns correct username', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.authDownloadLogLine);
  t.is(distributionEvent.username, t.context.username);
});

test('DistributionEvent.remoteIP returns correct IP for regular download', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.authDownloadLogLine);
  t.is(distributionEvent.remoteIP, '192.0.2.3');
});

test('DistributionEvent.remoteIP returns correct IP for download via proxy', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.proxyDownloadLogLine);
  t.is(distributionEvent.remoteIP, t.context.fakeIP);
});

test('DistributionEvent.toString() returns correct output for authenticated download', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.authDownloadLogLine);
  const output = await distributionEvent.toString();
  t.deepEqual(
    output.split('|&|'),
    [
      '24-FEB-20 03:05:51 PM',
      t.context.username,
      '192.0.2.3',
      `s3://${t.context.protectedBucket}/files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`,
      '21708',
      'S',
      'MOD09GQ',
      '001',
      t.context.metadataGranule.granuleId,
      'METADATA',
      'HTTPS',
    ]
  );
});

test('DistributionEvent.toString() returns correct output for un-authenticated download', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.noAuthDownloadLogLine);
  const output = await distributionEvent.toString();
  t.deepEqual(
    output.split('|&|'),
    [
      '24-FEB-20 09:45:37 PM',
      '-',
      '192.0.2.3',
      `s3://${t.context.publicBucket}/files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf`,
      '21708',
      'S',
      'MOD09GQ',
      '001',
      t.context.hdfGranule.granuleId,
      'SCIENCE',
      'HTTPS',
    ]
  );
});

test('DistributionEvent.toString() returns correct IP for download via proxy', async (t) => {
  const distributionEvent = new DistributionEvent(t.context.proxyDownloadLogLine);
  const output = await distributionEvent.toString();
  t.deepEqual(
    output.split('|&|'),
    [
      '24-FEB-20 03:05:51 PM',
      t.context.username,
      t.context.fakeIP,
      `s3://${t.context.protectedBucket}/files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`,
      '21708',
      'S',
      'MOD09GQ',
      '001',
      t.context.metadataGranule.granuleId,
      'METADATA',
      'HTTPS',
    ]
  );
});
