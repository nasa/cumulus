const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const log = require('@cumulus/common/log');
const { randomId } = require('@cumulus/common/test-utils');

const cmrUtils = rewire('../../cmr-utils');

test.before(async (t) => {
  // Store the CMR password
  t.context.cmrPassword = randomId('cmr_password');
  t.context.cmrPasswordSecretName = randomId('cmr_password_secret_name');
  process.env.cmr_password_secret_name = t.context.cmrPasswordSecretName;
  await awsServices.secretsManager().createSecret({
    Name: t.context.cmrPasswordSecretName,
    SecretString: t.context.cmrPassword
  }).promise();

  process.env.cmr_provider = randomId('cmr_provider');
  process.env.cmr_client_id = randomId('cmr_client_id');
  process.env.cmr_username = randomId('cmr_username');
});

test.beforeEach((t) => {
  t.context.granId = randomId('granuleId');
  t.context.distEndpoint = randomId('https://example.com/');
  t.context.published = true;
});

test.after.always(async (t) => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: t.context.cmrPasswordSecretName,
    ForceDeleteWithoutRecovery: true
  }).promise();
});

test('reconcileCMRMetadata does not call updateCMRMetadata if no metadatafile present', async (t) => {
  const updatedFiles = [
    { filename: 'anotherfile' },
    { filename: 'cmrmeta.cmr' }
  ];
  const {
    granId,
    distEndpoint,
    published
  } = t.context;
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
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
    distEndpoint,
    published
  } = t.context;

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const params = {
    granuleId: granId,
    updatedFiles,
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
    distEndpoint,
    published
  } = t.context;
  const mockLog = sinon.spy(log, 'error');
  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateCMRMetadata = cmrUtils.__set__('updateCMRMetadata', fakeUpdateCMRMetadata);

  const results = await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
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
  const { granId, distEndpoint } = t.context;
  const published = false;
  const fakeBuckets = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigJsonObject = sinon.fake.returns(fakeBuckets);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigJsonObject', fakeBucketsConfigJsonObject);

  const fakeUpdateCMRMetadata = sinon.fake.resolves(true);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  // act
  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    distEndpoint,
    published
  });

  const paramsIntoUpdateEcho10XML = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    distEndpoint,
    cmrGranuleUrlType: 'distribution',
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
    distEndpoint,
    published
  } = t.context;

  const fakeMetadataObject = { fake: 'metadata' };

  const fakeUpdateCMRMetadata = sinon.fake.resolves(fakeMetadataObject);
  const restoreUpdateEcho10XMLMetadata = cmrUtils.__set__('updateEcho10XMLMetadata', fakeUpdateCMRMetadata);

  const fakePublishECHO10XML2CMR = sinon.fake.resolves({});
  const restorePublishECHO10XML2CMR = cmrUtils.__set__('publishECHO10XML2CMR', fakePublishECHO10XML2CMR);

  const fakeBuckets = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigJsonObject = sinon.fake.returns(fakeBuckets);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigJsonObject', fakeBucketsConfigJsonObject);


  const bucket = randomId('bucket');
  const stackName = randomId('stack');
  process.env.system_bucket = bucket;
  process.env.stackName = stackName;
  const expectedMetadata = {
    filename: 'cmrmeta.cmr.xml',
    metadataObject: fakeMetadataObject,
    granuleId: granId
  };

  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    distEndpoint,
    published
  });

  const paramsIntoUpdateEcho10XML = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    distEndpoint,
    cmrGranuleUrlType: 'distribution',
    buckets: new BucketsConfig(fakeBuckets)
  };

  t.deepEqual(paramsIntoUpdateEcho10XML, fakeUpdateCMRMetadata.firstCall.args[0]);
  t.true(fakeUpdateCMRMetadata.calledOnce);
  t.true(fakePublishECHO10XML2CMR.calledOnce);
  t.true(
    fakePublishECHO10XML2CMR.calledWithMatch(
      sinon.match(expectedMetadata),
      sinon.match.object
    )
  );

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
    distEndpoint,
    published
  } = t.context;

  const defaultBucketsConfig = { private: { type: 'private', name: 'private' } };
  const fakeBucketsConfigJsonObject = sinon.fake.returns(defaultBucketsConfig);
  const restoreBucketsConfigDefaults = cmrUtils.__set__('bucketsConfigJsonObject', fakeBucketsConfigJsonObject);

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

  // act
  await cmrUtils.reconcileCMRMetadata({
    granuleId: granId,
    updatedFiles,
    distEndpoint,
    published
  });

  const paramsIntoUpdateUMMG = {
    cmrFile: updatedFiles[1],
    files: updatedFiles,
    distEndpoint,
    cmrGranuleUrlType: 'distribution',
    buckets
  };

  // assert
  t.deepEqual(paramsIntoUpdateUMMG, fakeUpdateUMMGMetadata.firstCall.args[0]);
  t.true(fakeUpdateUMMGMetadata.calledOnce);
  t.true(fakePublishUMMGJSON2CMR.calledOnce);
  t.true(fakePublishUMMGJSON2CMR.calledWithMatch(sinon.match(publishObject), sinon.match.object));

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
    distEndpoint,
    published
  } = t.context;
  const updateCMRMetadata = cmrUtils.__get__('updateCMRMetadata');

  await t.throwsAsync(
    () => updateCMRMetadata({
      granuleId: granId,
      cmrFile: badCMRFile,
      files: updatedFiles,
      distEndpoint,
      published,
      inBuckets: 'fakebucket'
    }),
    {
      name: 'CMRMetaFileNotFound',
      message: 'Invalid CMR filetype passed to updateCMRMetadata'
    }
  );
});

test('publishUMMGJSON2CMR calls ingestUMMGranule with ummgMetadata via valid CMR object', async (t) => {
  const cmrPublishObject = {
    filename: 'cmrfilename',
    metadataObject: { fake: 'metadata', GranuleUR: 'fakeGranuleID' },
    granuleId: 'fakeGranuleID'
  };
  const publishUMMGJSON2CMR = cmrUtils.__get__('publishUMMGJSON2CMR');
  const ingestFake = sinon.fake.resolves({ result: { 'concept-id': 'fakeID' } });
  const CmrFake = sinon.fake.returns({ ingestUMMGranule: ingestFake });

  const restoreCMR = cmrUtils.__set__('CMR', CmrFake);

  // Act
  await publishUMMGJSON2CMR(cmrPublishObject, new CmrFake());

  // Assert
  t.true(ingestFake.calledOnceWithExactly(cmrPublishObject.metadataObject));

  // Cleanup
  restoreCMR();
  sinon.restore();
});
