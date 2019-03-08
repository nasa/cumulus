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
  t.context.backendUrl = randomId('https://backend.com/');
  t.context.distEndpoint = randomId('https://example.com/');
  t.context.published = true;
});

test('reconcileCMRMetadata does not call updateCMRMetadata if no metadatafile present', async (t) => {
  const updatedFiles = [
    { filename: 'anotherfile' },
    { filename: 'cmrmeta.cmr' }
  ];
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  });

  t.falsy(results);
  t.false(fakeUpdateCMRMetadata.called);

  sinon.restore();
  restoreUpdateCMRMetadata();
});

test('reconcileCMRMetadata calls updateCMRMetadata if metadatafile present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const params = {
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  };

  const results = await cmrUtils.reconcileCMRMetadata(params);

  t.true(results);
  t.true(
    fakeUpdateCMRMetadata.calledOnceWith({
      granuleId: granId,
      cmrFile: updatedFiles[1],
      files: updatedFiles,
      backendUrl,
      distEndpoint,
      published
    })
  );

  sinon.restore();
  restoreUpdateCMRMetadata();
});

test('reconcileCMRMetadata logs an error if multiple metadatafiles present.', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile.cmr.json' }, { filename: 'cmrmeta.cmr.xml' }];
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;
  const mockLog = sinon.spy(log, 'error');
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  });

  t.falsy(results);
  t.false(fakeUpdateCMRMetadata.called);
  t.true(mockLog.calledOnceWith('More than one cmr metadata file found.'));

  sinon.restore();
  restoreUpdateCMRMetadata();
});


test('reconcileCMRMetadata calls updateEcho10XMLMetadata but not publishECHO10XML2CMR if xml metadata present and publish is false', async (t) => {
  // arrange
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const { granId, backendUrl, distEndpoint } = t.context;
  const published = false;
  const fakeBuckets = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigDefaults = sinon.fake.returns(fakeBuckets);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigDefaults', fakeBucketsConfigDefaults);

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  // act
  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  });

  const paramsIntoUpdateEcho10XML = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    backendUrl,
    distEndpoint,
    buckets: new BucketsConfig(fakeBuckets)
  };

  // assert
  t.deepEqual(paramsIntoUpdateEcho10XML, fakeUpdateCMRMetadata.firstCall.args[0]);
  t.true(fakeUpdateCMRMetadata.calledOnce);
  t.true(fakePublishECHO10XML2CMR.notCalled);

  // cleanup
  sinon.restore();
  restoreUpdateEcho10XMLMetadata();
  restorePublishECHO10XML2CMR();
  restoreBucketsConfigDefaults();
});

test('reconcileCMRMetadata calls updateEcho10XMLMetadata and publishECHO10XML2CMR if xml metadata present and publish is true', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;

  const fakeMetadataObject = { fake: 'metadata' };

  const fakeUpdateCMRMetadata = sinon.fake.resolves(fakeMetadataObject);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  const fakeBuckets = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigDefaults = sinon.fake.returns(fakeBuckets);
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

  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  });

  const paramsIntoUpdateEcho10XML = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    backendUrl,
    distEndpoint,
    buckets: new BucketsConfig(fakeBuckets)
  };

  t.deepEqual(paramsIntoUpdateEcho10XML, fakeUpdateCMRMetadata.firstCall.args[0]);
  t.true(fakeUpdateCMRMetadata.calledOnce);
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
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;

  const defaultBucketsConfig = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigDefaults = sinon.fake.returns(defaultBucketsConfig);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigDefaults', fakeBucketsConfigDefaults);

  const fakeUpdateUMMGMetadata = sinon.fake.resolves({ fake: 'metadata' });
  const restoreUpdateUMMGMetadata = cmrUtils.__set__('updateUMMGMetadata', fakeUpdateUMMGMetadata);

  const fakePublishUMMGJSON2CMR = sinon.fake.resolves({ });
  const restorePublishUMMGJSON2CMR = cmrUtils.__set__('publishUMMGJSON2CMR', fakePublishUMMGJSON2CMR);

  const publishObject = {
    filename: jsonCMRFile.filename,
    metadataObject: { fake: 'metadata' },
    granuleId: granId
  };

  const buckets = new BucketsConfig(defaultBucketsConfig);
  const systemBucket = randomId('systembucket');
  const stackName = randomId('stackname');
  process.env.system_bucket = systemBucket;
  process.env.stackName = stackName;
  const testCreds = setTestCredentials();

  // act
  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    backendUrl,
    distEndpoint,
    published
  });

  const paramsIntoUpdateUMMG = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    backendUrl,
    distEndpoint,
    buckets
  };

  // assert
  t.deepEqual(paramsIntoUpdateUMMG, fakeUpdateUMMGMetadata.firstCall.args[0]);
  t.true(fakeUpdateUMMGMetadata.calledOnce);
  t.true(
    fakePublishUMMGJSON2CMR.calledOnceWithExactly(publishObject, testCreds, systemBucket, stackName)
  );

  // cleanup
  sinon.restore();
  restoreUpdateUMMGMetadata();
  restorePublishUMMGJSON2CMR();
  restoreBucketsConfigDefaults();
});

test('updateCMRMetadata file throws error if incorrect cmrfile provided', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.json' }];
  const badCMRFile = { filename: 'notreallycmrfile' };
  const {
    granId,
    backendUrl,
    distEndpoint,
    published
  } = t.context;
  const updateCMRMetadata = cmrUtils.__get__('updateCMRMetadata');

  const error = await t.throws(
    // updateCMRMetadata(granId, badCMRFile, updatedFiles, distEndpoint, published, 'fakebucket')
    updateCMRMetadata({
      granuleId: granId,
      cmrFile: badCMRFile,
      files: updatedFiles,
      backendUrl,
      distEndpoint,
      published,
      inBuckets: 'fakebucket'
    })
  );

  t.is(error.name, 'CMRMetaFileNotFound');
  t.is(error.message, 'Invalid CMR filetype passed to updateCMRMetadata');
});

test('publishUMMGJSON2CMR calls ingestUMMGranule with ummgMetadata via valid CMR object', async (t) => {
  const cmrPublishObject = {
    filename: 'cmrfilename',
    metadataObject: { fake: 'metadata', GranuleUR: 'fakeGranuleID' },
    granuleId: 'fakeGranuleID'
  };
  const creds = setTestCredentials();
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;
  const publishUMMGJSON2CMR = cmrUtils.__get__('publishUMMGJSON2CMR');
  const ingestFake = sinon.fake.resolves({ result: { 'concept-id': 'fakeID' } });
  const cmrFake = sinon.fake.returns({ ingestUMMGranule: ingestFake });

  const restoreCMR = cmrUtils.__set__('CMR', cmrFake);

  // Act
  try {
    await publishUMMGJSON2CMR(cmrPublishObject, creds, systemBucket, stackName);
  }
  catch (error) {
    console.log(error);
  }


  // Assert
  t.true(cmrFake.calledOnceWithExactly(
    creds.provider, creds.clientId, creds.username, creds.password
  ));
  t.true(ingestFake.calledOnceWithExactly(cmrPublishObject.metadataObject));

  // Cleanup
  restoreCMR();
  sinon.restore();
});
