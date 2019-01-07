const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const cmrUtils = rewire('../cmr-utils');

const { log, errors } = require('@cumulus/common');

const { randomId } = require('@cumulus/common/test-utils');


function expectedCreds() {
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
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateCMRMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.falsy(results);
  t.false(fakeCall.called);

  sinon.restore();
  restore();
});

test('reconcileCMRMetadata calls updateCMRMetadata if metadatafile present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateCMRMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(results);
  t.true(fakeCall.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint, pub));

  sinon.restore();
  restore();
});

test('reconcileCMRMetadata logs an error if multiple metadatafiles present.', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile.cmr.json' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;
  const mockLog = sinon.spy(log, 'error');
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateCMRMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.falsy(results);
  t.false(fakeCall.called);
  t.true(mockLog.calledOnceWith('More than one cmr metadata file found.'));
  mockLog.restore();
  restore();
});


test('reconcileCMRMetadata calls updateEcho10XMLMetadata but not publishECHO10XML2CMR if xml metadata present and publish is false', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint } = t.context;
  const pub = false;
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateEcho10XMLMetadata', fakeCall);

  const fakeCall2 = sinon.fake.resolves({});
  const restore2 = cmrUtils.__set__('publishECHO10XML2CMR', fakeCall2);

  await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(fakeCall.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint));
  t.true(fakeCall2.notCalled);
  restore();
  restore2();
});

test('reconcileCMRMetadata calls updateEcho10XMLMetadata and publishECHO10XML2CMR if xml metadata present and publish is true', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;

  const fakeMetadataObject = { fake: 'metadata' };

  const fakeCall = sinon.fake.resolves(fakeMetadataObject);
  const restore = cmrUtils.__set__('updateEcho10XMLMetadata', fakeCall);

  const fakeCall2 = sinon.fake.resolves({});
  const restore2 = cmrUtils.__set__('publishECHO10XML2CMR', fakeCall2);

  const bucket = randomId('bucket');
  const stackName = randomId('stack');
  process.env.bucket = bucket;
  process.env.stackName = stackName;
  const testCreds = expectedCreds();
  const expectedMetadata = {
    filename: 'cmrmeta.cmr.xml',
    metadataObject: fakeMetadataObject,
    granuleId: granId
  };

  await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(fakeCall.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint));
  t.true(fakeCall2.calledOnceWith(expectedMetadata, testCreds, bucket, stackName));
  restore();
  restore2();
});

test('reconcileCMRMetadata calls updateUMMGMetadata if json metadata present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.json' }];
  const { granId, distEndpoint, pub } = t.context;
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateUMMGMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(results);
  t.true(fakeCall.calledOnceWith());
  restore();
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
