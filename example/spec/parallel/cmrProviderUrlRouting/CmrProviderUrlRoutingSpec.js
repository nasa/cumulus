'use strict';

/**
 * Integration test for per-cmrProvider TEA distribution URL routing (CUMULUS-4664).
 *
 * Verifies end-to-end that a granule whose Collection has a cmrProvider matching
 * an entry in `tea_distribution_url_per_cmr_provider` gets CMR OnlineAccessURLs
 * built against that per-provider host (not the default tea_distribution_url).
 *
 * Path exercised:
 *   Collections API (DB write of cmrProvider)
 *   -> meta.cmr.provider on workflow message
 *   -> meta.distribution_endpoint_per_cmr_provider on workflow message
 *   -> CMA mapping into UpdateGranulesCmrMetadataFileLinks task config
 *   -> resolveDistributionEndpoint
 *   -> CMR OnlineAccessURL written to .cmr.xml in S3
 *
 * Preconditions:
 *   - Deployment has tea_distribution_url_per_cmr_provider populated in tfvars
 *     and re-applied (so workflow_template.json carries the map).
 *   - IngestAndPublishGranule workflow is deployed.
 *
 * Run from repo root:
 *   cd example
 *   DEPLOYMENT=<your-deployment-name> AWS_REGION=us-east-1 \
 *     ../node_modules/.bin/jasmine spec/parallel/cmrProviderUrlRouting/CmrProviderUrlRoutingSpec.js
 */

const fs = require('fs-extra');
const path = require('path');
const get = require('lodash/get');
const noop = require('lodash/noop');

const { getJsonS3Object, getObjectStreamContents, getObject } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');
const { addProviders, cleanupProviders } = require('@cumulus/integration-tests');
const { isCMRFile } = require('@cumulus/cmrjs');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deletePdr } = require('@cumulus/api-client/pdrs');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestSuffix,
} = require('../../helpers/testUtils');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 15 * 60 * 1000;

/**
 * Fetch the deployed message template and pull the per-provider distribution-endpoint map.
 * Returns null if the map is empty or absent — caller should skip the per-provider test in that case.
 */
async function getDistributionEndpointMap(systemBucket, stackName) {
  const template = await getJsonS3Object(systemBucket, `${stackName}/workflow_template.json`);
  const map = get(template, 'meta.distribution_endpoint_per_cmr_provider');
  if (!map || Object.keys(map).length === 0) return null;
  return {
    map,
    defaultEndpoint: template.meta.distribution_endpoint,
  };
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return null;
  }
}

describe('IngestAndPublishGranule with per-cmrProvider TEA URL routing', () => {
  let config;
  let testId;
  let testSuffix;
  let testDataFolder;
  let collection;
  let provider;
  let inputPayload;
  let workflowExecution;
  let endpointConfig;
  let chosenCmrProvider;
  let expectedHost;
  let granuleId;
  let collectionId;
  let setupError;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      endpointConfig = await getDistributionEndpointMap(config.bucket, config.stackName);
      if (!endpointConfig) {
        setupError = new Error(
          'workflow_template.json has no meta.distribution_endpoint_per_cmr_provider entries; ' +
          'set tea_distribution_url_per_cmr_provider in tfvars and re-apply terraform before running this spec.'
        );
        return;
      }

      // Pick the first provider in the map and derive the expected host
      chosenCmrProvider = Object.keys(endpointConfig.map)[0];
      expectedHost = hostnameOf(endpointConfig.map[chosenCmrProvider]);

      testId = createTimestampedTestId(config.stackName, 'CmrProviderUrlRouting');
      testSuffix = createTestSuffix(testId);
      testDataFolder = `${config.stackName}/cmrProviderRoutingTest/${testId}`;

      // Stage source data files
      const s3data = [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
      ];

      // Load source collection fixture, override cmrProvider to the one we picked
      const baseCollectionPath = path.join(__dirname, '..', '..', '..', 'data', 'collections', 's3_MOD09GQ_006', 's3_MOD09GQ_006.json');
      const baseCollection = JSON.parse(fs.readFileSync(baseCollectionPath, 'utf8'));
      const overrides = {
        name: `${baseCollection.name}${testSuffix}`,
        cmrProvider: chosenCmrProvider,
      };

      // Add provider + collection in parallel with data upload
      [collection] = await Promise.all([
        createCollection(config.stackName, { ...baseCollection, ...overrides }),
        addProviders(config.stackName, config.bucket, './data/providers/s3/', config.bucket, testSuffix),
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      ]);

      // The integration-tests Providers helper uses suffix for the id
      provider = { id: `s3_provider${testSuffix}` };

      // Build input payload for IngestAndPublishGranule
      const inputPayloadJson = fs.readFileSync(
        path.join(__dirname, '..', 'ingestGranule', 'IngestGranule.input.payload.json'),
        'utf8'
      );
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;
      collectionId = constructCollectionId(collection.name, collection.version);

      // Trigger the workflow with our chosen cmrProvider.
      // IngestGranule is used (rather than IngestAndPublishGranule) because it includes
      // UpdateGranulesCmrMetadataFileLinks (the task that writes per-cmrProvider URLs to
      // the CMR file in S3 — what this test verifies) but skips Hyrax and PostToCmr, which
      // require CMR/EDL credentials that may not be present in dev environments.
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        'IngestGranule',
        { name: collection.name, version: collection.version },
        provider,
        inputPayload,
        {}, // meta overrides (none)
        900,
        chosenCmrProvider
      );
    } catch (error) {
      setupError = error;
    }
  });

  afterAll(async () => {
    // Cleanup order matters due to FK constraints:
    //   granule -> execution -> pdr -> collection / provider -> S3 data
    try {
      if (granuleId && collectionId) {
        await deleteGranule({ prefix: config.stackName, granuleId, collectionId }).catch(noop);
      }
      if (get(workflowExecution, 'executionArn')) {
        await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn }).catch(noop);
      }
      const pdrName = get(inputPayload, 'pdr.name');
      if (pdrName) {
        await deletePdr({ prefix: config.stackName, pdrName }).catch(noop);
      }
      if (collection) {
        await deleteCollection({
          prefix: config.stackName,
          collectionName: collection.name,
          collectionVersion: collection.version,
        }).catch(noop);
      }
      if (provider) {
        await cleanupProviders(config.stackName, config.bucket, './data/providers/s3/', testSuffix).catch(noop);
      }
      if (testDataFolder) {
        await deleteFolder(config.bucket, testDataFolder).catch(noop);
      }
    } catch (_) { /* swallow cleanup errors */ }
  });

  it('completes ingest setup without error', () => {
    if (setupError) fail(setupError);
    expect(workflowExecution).toBeDefined();
    expect(workflowExecution.status).toBe('completed');
  });

  it('uses the per-cmrProvider TEA URL host in the published CMR OnlineAccessURLs', async () => {
    if (setupError) fail(setupError);
    expect(expectedHost).toBeTruthy();

    // After the workflow completes, fetch the Step Functions execution output to
    // locate the granule's CMR file in S3.
    const execution = await StepFunctions.describeExecution({
      executionArn: workflowExecution.executionArn,
    });
    const rawOutput = JSON.parse(execution.output);
    const fullOutput = await pullStepFunctionEvent(rawOutput);

    const outputGranules = get(fullOutput, 'payload.granules', get(fullOutput, 'meta.input_granules', []));
    const outputGranule = outputGranules.find((g) => g.granuleId === granuleId);
    expect(outputGranule).toBeDefined();

    const cmrFile = outputGranule.files.find(isCMRFile);
    expect(cmrFile).toBeDefined();

    // Fetch raw CMR file contents and verify the per-provider host is present.
    // This works for both ECHO10 XML and UMM-G JSON without needing to parse them.
    const response = await getObject(s3(), { Bucket: cmrFile.bucket, Key: cmrFile.key });
    const rawCmrBody = await getObjectStreamContents(response.Body);

    const expectedDefaultHost = hostnameOf(endpointConfig.defaultEndpoint);

    const expectedHostPresent = rawCmrBody.includes(expectedHost);
    const defaultHostPresent = expectedDefaultHost && rawCmrBody.includes(expectedDefaultHost);

    if (!expectedHostPresent || defaultHostPresent) {
      console.error('CMR file content (first 4000 chars):', rawCmrBody.slice(0, 4000));
      console.error('Expected per-provider host:', expectedHost);
      console.error('Default fallback host (should NOT appear):', expectedDefaultHost);
    }

    expect(expectedHostPresent).withContext(`expected host "${expectedHost}" in CMR file`).toBeTrue();
    expect(defaultHostPresent).withContext(`default host "${expectedDefaultHost}" should NOT appear in CMR file`).toBeFalse();
  });
});
