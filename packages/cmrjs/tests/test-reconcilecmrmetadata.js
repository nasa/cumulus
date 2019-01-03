const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const cmrUtils = rewire('../cmr-utils');

const log = require('@cumulus/common/log');

const { randomId } = require('@cumulus/common/test-utils');


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


test('reconcileCMRMetadata calls updateEcho10XMLMetadata if xml metadata present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, distEndpoint, pub } = t.context;
  const fakeCall = sinon.fake.resolves(true);
  const restore = cmrUtils.__set__('updateEcho10XMLMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);

  t.true(results);
  t.true(fakeCall.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint, pub));
  restore();
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
