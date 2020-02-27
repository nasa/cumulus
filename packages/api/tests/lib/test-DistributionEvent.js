const test = require('ava');
const sinon = require('sinon');

const { randomString } = require('@cumulus/common/test-utils');

const DistributionEvent = require('../../lib/DistributionEvent');
const {
  fakeGranuleFactoryV2,
  fakeFileFactory
} = require('../../lib/testUtils');
const FileClass = require('../../models/files');

test.before(() => {
  process.env.FilesTable = randomString();
});

test.beforeEach(async (t) => {
  t.context.username = randomString();
  t.context.authDownloadLogLine = 'fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e '
    + 'protected-bucket [24/Feb/2020:15:05:51 +0000] '
    + '192.0.2.3 arn:aws:sts::XXXXXXXX:assumed-role/DownloadRoleLocal '
    + '30E6BC41DB11A8CE REST.GET.OBJECT '
    + 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met '
    + `"GET /files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met?A-userid=${t.context.username}`
    + '&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=XXXXX&X-Amz-Date=20200224T150551Z&X-Amz-Expires=86400&'
    + 'X-Amz-Security-Token=XXXXX&X-Amz-SignedHeaders=host&X-Amz-Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX HTTP/1.1" '
    + '200 - 21708 21708 28 27 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:73.0) '
    + 'Gecko/20100101 Firefox/73.0" - k0f1eqG9dkjCcPtRsuZRXNFyNAqpXANK/GFJz9C+fKUiH2V4+O6HcUCdKZlL3XOhH5BZ/UJMqEU='
    + 'SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString protected-bucket.s3.amazonaws.com TLSv1.2';
  t.context.noAuthDownloadLogLine = 'fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e '
    + 'public-bucket [24/Feb/2020:21:45:37 +0000] '
    + '192.0.2.3 arn:aws:sts::XXXXXXXX:assumed-role/DownloadRoleLocal '
    + '30E6BC41DB11A8CE REST.GET.OBJECT '
    + 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf '
    + '"GET /files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf?A-userid=None'
    + '&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=XXXXX&X-Amz-Date=20200224T150551Z&X-Amz-Expires=86400&'
    + 'X-Amz-Security-Token=XXXXX&X-Amz-SignedHeaders=host&X-Amz-Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX HTTP/1.1" '
    + '200 - 21708 21708 28 27 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:73.0) '
    + 'Gecko/20100101 Firefox/73.0" - k0f1eqG9dkjCcPtRsuZRXNFyNAqpXANK/GFJz9C+fKUiH2V4+O6HcUCdKZlL3XOhH5BZ/UJMqEU='
    + 'SigV4 ECDHE-RSA-AES128-GCM-SHA256 QueryString public-bucket.s3.amazonaws.com TLSv1.2';
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
});

test.serial('DistributionEvent.toString() returns correct output for authenticated download', async (t) => {
  const granule = fakeGranuleFactoryV2({
    collectionId: 'MOD09GQ___001',
    files: [
      fakeFileFactory({
        bucket: 'protected-bucket',
        key: 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        type: 'metadata'
      })
    ]
  });

  const stub = sinon.stub(FileClass.prototype, 'getGranuleForFile')
    .callsFake(() => Promise.resolve(granule));

  try {
    const distributionEvent = new DistributionEvent(t.context.authDownloadLogLine);
    const output = await distributionEvent.toString();
    t.is(
      output,
      [
        '24-FEB-20 03:05:51 PM',
        t.context.username,
        '192.0.2.3',
        's3://protected-bucket/files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        '21708',
        'S',
        'MOD09GQ',
        '001',
        granule.granuleId,
        'METADATA',
        'HTTPS'
      ].join('|&|')
    );
  } finally {
    stub.restore();
  }
});

test.serial('DistributionEvent.toString() returns correct output for un-authenticated download', async (t) => {
  const granule = fakeGranuleFactoryV2({
    collectionId: 'MOD09GQ___001',
    files: [
      fakeFileFactory({
        bucket: 'public-bucket',
        key: 'files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        type: 'data'
      })
    ]
  });

  const stub = sinon.stub(FileClass.prototype, 'getGranuleForFile')
    .callsFake(() => Promise.resolve(granule));

  try {
    const distributionEvent = new DistributionEvent(t.context.noAuthDownloadLogLine);
    const output = await distributionEvent.toString();
    t.is(
      output,
      [
        '24-FEB-20 09:45:37 PM',
        '-',
        '192.0.2.3',
        's3://public-bucket/files/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        '21708',
        'S',
        'MOD09GQ',
        '001',
        granule.granuleId,
        'SCIENCE',
        'HTTPS'
      ].join('|&|')
    );
  } finally {
    stub.restore();
  }
});
