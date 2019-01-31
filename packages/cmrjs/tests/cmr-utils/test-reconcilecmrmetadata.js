const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const cmrUtils = rewire('../../cmr-utils');

const { BucketsConfig, log } = require('@cumulus/common');

const { randomId } = require('@cumulus/common/test-utils');


function setTestCredentials() {
  process.env.cmr_provider = randomId('cmr_provider');
  process.env.cmr_client_id = randomId('cmr_client_id');
  process.env.cmr_username = randomId('cmr_username');
  process.env.cmr_password = randomId('cmr_password');

  return {
    provider: process.env.cmr_provider,
    clientId: process.env.cmr_client_id,
    username: process.env.cmr_username,
    password: process.env.cmr_password
  };
}

test.beforeEach((t) => {
  t.context.granId = randomId('granuleId');
  t.context.distEndpoint = randomId('https://example.com/');
  t.context.pub = true;
});

test('reconcileCMRMetadata does not call updateCMRMetadata if no metadatafile present', async (t) => {
  const updatedFiles = [
    { filename: 'anotherfile' },
    { filename: 'cmrmeta.cmr' }
  ];
  const { granId, distEndpoint, pub } = t.context;
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.falsy(results);
  t.false(fakeUpdateCMRMetadata.called);

  sinon.restore();
  restoreUpdateCMRMetadata();
});

test('reconcileCMRMetadata calls updateCMRMetadata if metadatafile present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(results);
  t.true(
    fakeUpdateCMRMetadata.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint, pub)
  );

  sinon.restore();
  restoreUpdateCMRMetadata();
});

test('reconcileCMRMetadata logs an error if multiple metadatafiles present.', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile.cmr.json' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;
  const mockLog = sinon.spy(log, 'error');
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.falsy(results);
  t.false(fakeUpdateCMRMetadata.called);
  t.true(mockLog.calledOnceWith('More than one cmr metadata file found.'));

  sinon.restore();
  mockLog.restore();
  restoreUpdateCMRMetadata();
});


test('reconcileCMRMetadata calls updateEcho10XMLMetadata but not publishECHO10XML2CMR if xml metadata present and publish is false', async (t) => {
  // arrange
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint } = t.context;
  const pub = false;
  const fakeBucketsConfigDefaults = sinon.fake.returns({ private: { type: 'private', name: 'private' } });
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigDefaults', fakeBucketsConfigDefaults);

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  // act
  await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  // assert
  t.true(fakeUpdateCMRMetadata.calledOnceWith(updatedFiles[1], updatedFiles, distEndpoint));
  t.true(fakePublishECHO10XML2CMR.notCalled);

  // cleanup
  sinon.restore();
  restoreUpdateEcho10XMLMetadata();
  restorePublishECHO10XML2CMR();
  restoreBucketsConfigDefaults();
});

test('reconcileCMRMetadata calls updateEcho10XMLMetadata and publishECHO10XML2CMR if xml metadata present and publish is true', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;

  const fakeMetadataObject = { fake: 'metadata' };

  const fakeUpdateCMRMetadata = sinon.fake.resolves(fakeMetadataObject);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  const fakeBucketsConfigDefaults = sinon.fake.returns({ private: { type: 'private', name: 'private' } });
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigDefaults', fakeBucketsConfigDefaults);


  const bucket = randomId('bucket');
  const stackName = randomId('stack');
  process.env.system_bucket = bucket;
  process.env.stackName = stackName;
  const testCreds = setTestCredentials();
  const expectedMetadata = {
    filename: 'cmrmeta.cmr.xml',
    metadataObject: fakeMetadataObject,
    granuleId: granId
  };

  await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(fakeUpdateCMRMetadata.calledOnceWith(updatedFiles[1], updatedFiles, distEndpoint));
  t.true(fakePublishECHO10XML2CMR.calledOnceWith(expectedMetadata, testCreds, bucket, stackName));

  sinon.restore();
  restoreUpdateEcho10XMLMetadata();
  restorePublishECHO10XML2CMR();
  restoreBucketsConfigDefaults();
});

test('reconcileCMRMetadata calls updateUMMGMetadata and publishUMMGJSON2CMR if if json metadata present and publish true', async (t) => {
  // arrange
  const jsonCMRFile = { filename: 'cmrmeta.cmr.json' };
  const updatedFiles = [{ filename: 'anotherfile' }, jsonCMRFile];
  const { granId, distEndpoint, pub } = t.context;

  const defaultBucketsConfig = { private: { type: 'private', name: 'private' } };

  const fakeBucketsConfigDefaults = sinon.fake.returns(defaultBucketsConfig);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigDefaults', fakeBucketsConfigDefaults);

  const fakeUpdateUMMGMetadata = sinon.fake.resolves({ fake: 'metadata' });
  const restoreUpdateUMMGMetadata = cmrUtils.__set__('updateUMMGMetadata', fakeUpdateUMMGMetadata);

  const fakePublishUMMGJSON2CMR = sinon.fake.resolves({ });
  const restorePublishUMMGJSON2CMR = cmrUtils.__set__('publishUMMGJSON2CMR', fakePublishUMMGJSON2CMR);

  const buckets = new BucketsConfig(defaultBucketsConfig);
  const systemBucket = randomId('systembucket');
  const stackName = randomId('stackname');
  process.env.system_bucket = systemBucket;
  process.env.stackName = stackName;
  const testCreds = setTestCredentials();

  // act
  await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  // assert
  t.true(fakeUpdateUMMGMetadata.calledOnceWithExactly(jsonCMRFile, updatedFiles, distEndpoint, buckets));
  t.true(fakePublishUMMGJSON2CMR.calledOnceWithExactly({ fake: 'metadata' }, testCreds, systemBucket, stackName));

  // cleanup
  sinon.restore();
  restoreUpdateUMMGMetadata();
  restorePublishUMMGJSON2CMR();
  restoreBucketsConfigDefaults();
});

test('updateCMRMetadata file throws error if incorrect cmrfile provided', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.json' }];
  const badCMRFile = { filename: 'notreallycmrfile' };
  const { granId, distEndpoint, pub } = t.context;
  const updateCMRMetadata = cmrUtils.__get__('updateCMRMetadata');

  const error = await t.throws(
    updateCMRMetadata(granId, badCMRFile, updatedFiles, distEndpoint, pub)
  );

  t.is(error.name, 'CMRMetaFileNotFound');
  t.is(error.message, 'Invalid CMR filetype passed to updateCMRMetadata');
});
