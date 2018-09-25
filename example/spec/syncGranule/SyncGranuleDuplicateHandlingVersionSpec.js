const fs = require('fs');
const path = require('path');
const {
  aws: {
    headObject,
    parseS3Uri,
    s3
  },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');
const { api: apiTestUtils } = require('@cumulus/integration-tests');
const { loadConfig, templateFile } = require('../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleId
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'SyncGranuleDuplicateVersionTest';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';

const outputPayloadTemplateFilename = './spec/syncGranule/SyncGranule.output.payload.template.json';
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config.SyncGranule
});

describe('The Sync Granule workflowworkflow is configured keep both files when encountering duplicate filenames', () => {
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  let inputPayload;
  let expectedPayload;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution;

  beforeAll(async () => {
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, testDataGranuleId, granuleRegex);

    const granuleId = inputPayload.granules[0].granuleId;
    expectedPayload = loadFileWithUpdatedGranuleId(templatedOutputPayloadFilename, testDataGranuleId, granuleId);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // Remove the granule files added for the test
    await Promise.all(
      inputPayload.granules[0].files.map((file) =>
        s3().deleteObject({
          Bucket: config.bucket, Key: `${file.path}/${file.name}`
        }).promise())
    );
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('and it encounters data with a duplicated filename with duplicate checksum', () => {
    let lambdaOutput;
    let existingfiles;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;
      existingfiles = await Promise.all(files.map(async (f) => {
        const header = await headObject(f.bucket, parseS3Uri(f.filename).Key);
        return { filename: f.filename, fileSize: header.ContentLength, LastModified: header.LastModified };
      }));

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('does not create a copy of the file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;

      const currentFiles = await Promise.all(files.map(async (f) => {
        const header = await headObject(f.bucket, parseS3Uri(f.filename).Key);
        return { filename: f.filename, fileSize: header.ContentLength, LastModified: header.LastModified };
      }));

      expect(currentFiles).toEqual(existingfiles);
      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });
  });

  describe('and it encounters data with a duplicated filename with different checksum', () => {
    let lambdaOutput;
    let existingfiles;
    let fileUpdated;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;
      existingfiles = await Promise.all(files.map(async (f) => {
        const header = await headObject(f.bucket, parseS3Uri(f.filename).Key);
        return { filename: f.filename, fileSize: header.ContentLength, LastModified: header.LastModified };
      }));

      // update one of the input files, so that the file has different checksum
      const content = randomString();
      const file = inputPayload.granules[0].files[0];
      fileUpdated = file.name;
      const updateParams = {
        Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
      };

      await s3().putObject(updateParams).promise();
      inputPayload.granules[0].files[0].fileSize = content.length;

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('moves the existing data to a file with a suffix to distinguish it from the new file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;
      expect(files.length).toEqual(3);

      const renamedFiles = files.filter((f) => f.name.startsWith(`${fileUpdated}.v`));
      expect(renamedFiles.length).toEqual(1);

      const expectedRenamedFileSize = existingfiles.filter((f) => f.filename.endsWith(fileUpdated))[0].fileSize;
      expect(renamedFiles[0].fileSize).toEqual(expectedRenamedFileSize);
    });

    it('captures both files', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.files.length).toEqual(3);
    });
  });

  describe('and it encounters data with a duplicated filename with different checksum and there is an existing versioned file', () => {
    let lambdaOutput;
    let updatedFileName;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');

      // update one of the input files, so that the file has different checksum
      const content = `${randomString()}`;
      const file = inputPayload.granules[0].files[0];
      updatedFileName = file.name;
      const updateParams = {
        Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
      };

      await s3().putObject(updateParams).promise();
      inputPayload.granules[0].files[0].fileSize = content.length;

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('moves the existing data to a file with a suffix to distinguish it from the new file and existing versioned file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;
      expect(files.length).toEqual(4);

      const renamedFiles = files.filter((f) => f.name.startsWith(`${updatedFileName}.v`));
      expect(renamedFiles.length).toEqual(2);
    });

    it('captures all files', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.files.length).toEqual(4);
    });
  });
});
