'use strict';

const pTimeout = require('p-timeout');

const {
  GetFunctionConfigurationCommand,
  InvokeCommand,
} = require('@aws-sdk/client-lambda');

const { lambda } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Add Unique Granule Id Task ', () => {
  let beforeAllFailed;
  let granuleId;
  let collection;
  let config;
  let functionConfig;
  let addUniqueGranuleIdFunctionName;
  let prefix;
  let functionOutput;
  const pdr = {
    pdrName: 'fakePdr',
    provider: 'fakeProvider',
    collectionId: 'FAKECOLLECTION___001',
  };

  const testSetup = async (configOverride = {}) => {
    try {
      beforeAllFailed = false;
      config = await loadConfig();
      prefix = config.stackName;
      addUniqueGranuleIdFunctionName = `${prefix}-AddUniqueGranuleId`;
      functionConfig = await lambda().send(new GetFunctionConfigurationCommand({
        FunctionName: addUniqueGranuleIdFunctionName,
      }));
      granuleId = `FakeGranule_${randomString()}`;

      const configObject = {
        cma: {
          ReplaceConfig: {
            Path: '$.payload',
            TargetPath: '$.payload',
            MaxSize: 1000000,
          },
          event: {
            cumulus_meta: {
              system_bucket: config.bucket,
            },
            meta: {
              buckets: config.buckets,
              collection,
              stack: config.stackName,
            },
            payload: {
              granules: [
                {
                  granuleId,
                  dataType: 'FAKECOLLECTION',
                  version: '001',
                  files: [],
                },
                {
                  granuleId,
                  dataType: 'FAKECOLLECTION',
                  version: '001',
                  files: [],
                },
              ],
              pdr,
            },
          },
        },
      };

      configObject.cma.task_config = { ...configObject.cma.task_config, ...configOverride.task_config };

      const Payload = new TextEncoder().encode(
        JSON.stringify({ ...configObject, ...configOverride })
      );

      functionOutput = await pTimeout(
        lambda().send(new InvokeCommand({ FunctionName: addUniqueGranuleIdFunctionName, Payload })),
        (functionConfig.Timeout + 10) * 1000
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  };

  describe('The Add Unique Granule Id Task with default hash config', () => {
    it('invokes successfully', async () => {
      await testSetup();
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(functionOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected outputs', () => {
      const payload = JSON.parse(new TextDecoder('utf-8').decode(functionOutput.Payload)).payload;
      expect(payload.granules[0].producerGranuleId).toBe(granuleId);
      expect(payload.granules[0].granuleId).toMatch(
        new RegExp(`^${granuleId}_[a-zA-Z0-9-]{8}$`)
      );
      expect(payload.granules[1].producerGranuleId).toBe(granuleId);
      expect(payload.granules[1].granuleId).toMatch(
        new RegExp(`^${granuleId}_[a-zA-Z0-9-]{8}$`)
      );
      expect(payload.granules[1].producerGranuleId === payload.granules[0].producerGranuleId &&
        payload.granules[0].granuleId === payload.granules[1].granuleId);
      expect(payload.pdr).toEqual(pdr);
    });
  });

  describe('The Add Unique Granule Id Task with customized hash config', () => {
    it('invokes successfully', async () => {
      const newTaskConfig = {
        hashLength: 6,
        includeTimestampHashKey: true,
      };
      await testSetup({ task_config: newTaskConfig });
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(functionOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected output', () => {
      const payload = JSON.parse(new TextDecoder('utf-8').decode(functionOutput.Payload)).payload;
      expect(payload.granules[0].producerGranuleId).toBe(granuleId);
      expect(payload.granules[0].granuleId).toMatch(
        new RegExp(`^${granuleId}_[a-zA-Z0-9-]{6}$`)
      );
      expect(payload.granules[1].producerGranuleId).toBe(granuleId);
      expect(payload.granules[1].granuleId).toMatch(
        new RegExp(`^${granuleId}_[a-zA-Z0-9-]{6}$`)
      );
      expect(payload.granules[1].producerGranuleId === payload.granules[0].producerGranuleId &&
        payload.granules[0].granuleId !== payload.granules[1].granuleId);
    });
  });
});
