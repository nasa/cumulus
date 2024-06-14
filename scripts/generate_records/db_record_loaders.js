// @ts-check

/* eslint-disable no-await-in-loop */

const Logger = require('@cumulus/logger');
const {
  CollectionPgModel,
  ProviderPgModel,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  fakeExecutionRecordFactory,
  fakeRuleRecordFactory,
  RulePgModel,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
} = require('@cumulus/db');
const { randomString } = require('@cumulus/common/test-utils');

const log = new Logger({
  sender: '@cumulus/generate_records',
});

/**
 * @typedef {import('@cumulus/db').PostgresFile} PostgresFile
 * @typedef {import('@cumulus/db').PostgresGranule} PostgresGranule
 * @typedef {import('@cumulus/db').PostgresCollection} PostgresCollection
 * @typedef {import('@cumulus/db').GranulesExecutionsPgModel} GranulesExecutionsPgModel
 * @typedef {import('@cumulus/db').ExecutionPgModel} ExecutionPgModel
 * @typedef {import('@cumulus/db').GranulePgModel} GranulePgModel
 * @typedef {import('@cumulus/db').FilePgModel} FilePgModel
 * @typedef {import('knex').Knex} Knex
 * @typedef {{
*   geModel: GranulesExecutionsPgModel,
*   executionModel: ExecutionPgModel,
*   granuleModel: GranulePgModel,
*   fileModel: FilePgModel
* }} ModelSet
* @typedef {{
*   name: string,
*   version: string,
* }} CollectionDetails
*/
/**
 * upload executions corresponding to collection with collectionCumulusId
 *
 * @param {Knex} knex
 * @param {number} collectionCumulusId
 * @param {number} executionCount
 * @param {ExecutionPgModel} model
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded execution
 */
const loadExecutions = async (
  knex,
  collectionCumulusId,
  executionCount,
  model,
  swallowErrors = false
) => {
  const executionCumulusIds = [];
  for (let i = 0; i < executionCount; i += 1) {
    const execution = fakeExecutionRecordFactory({ collection_cumulus_id: collectionCumulusId });
    try {
      const [executionOutput] = await model.upsert(knex, execution);
      executionCumulusIds.push(executionOutput.cumulus_id);
    } catch (error) {
      if (!swallowErrors) throw error;
      log.error(`failed up upload execution: ${error}`);
    }
  }
  return executionCumulusIds;
};

/**
 * upload granuleExecutions corresponding to each pair
 * within list of granuleCumulusIds and executionCumulusIds
 *
 * @param {Knex} knex
 * @param {Array<number>} granuleCumulusIds
 * @param {Array<number>} executionCumulusIds
 * @param {GranulesExecutionsPgModel} model
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>} - granuleExecutions
 */
const loadGranulesExecutions = async (
  knex,
  granuleCumulusIds,
  executionCumulusIds,
  model,
  swallowErrors = false
) => {
  const uploaded = [];
  for (let i = 0; i < granuleCumulusIds.length; i += 1) {
    for (let j = 0; j < executionCumulusIds.length; j += 1) {
      try {
        const [uploadedGranuleExecution] = await model.upsert(
          knex,
          {
            granule_cumulus_id: granuleCumulusIds[i],
            execution_cumulus_id: executionCumulusIds[j],
          }
        );
        uploaded.push(uploadedGranuleExecution);
      } catch (error) {
        if (!swallowErrors) throw error;
        log.error(`failed up upload granuleExecution: ${error}`);
      }
    }
  }
  return uploaded;
};

/**
 * upload granules corresponding to collection with collectionCumulusId
 *
 * @param {Knex} knex
 * @param {number} collectionCumulusId
 * @param {number} providerCumulusId
 * @param {number} granuleCount
 * @param {GranulePgModel} model
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded granule
 */
const loadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  model,
  swallowErrors = false
) => {
  const granuleCumulusIds = [];
  for (let i = 0; i < granuleCount; i += 1) {
    const granule = /** @type {PostgresGranule} */(fakeGranuleRecordFactory({
      granule_id: randomString(6),
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      status: 'completed',
    }));
    try {
      const [granuleOutput] = await model.upsert({
        knexOrTrx: knex,
        granule,
        writeConstraints: true,
      });
      granuleCumulusIds.push(granuleOutput.cumulus_id);
    } catch (error) {
      if (!swallowErrors) {
        throw error;
      }
      log.error(`failed to upload granule: ${error}`);
    }
  }
  return granuleCumulusIds;
};

/**
 * upload files corresponding to granule with granuleCumulusId
 *
 * @param {Knex} knex
 * @param {number} granuleCumulusId
 * @param {number} fileCount
 * @param {FilePgModel} model
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>}
 */
const loadFiles = async (
  knex,
  granuleCumulusId,
  fileCount,
  model,
  swallowErrors = false
) => {
  const uploaded = [];
  for (let i = 0; i < fileCount; i += 1) {
    const file = /** @type {PostgresFile} */(fakeFileRecordFactory({
      bucket: `${i}`,
      granule_cumulus_id: granuleCumulusId,
      key: randomString(8),
    }));
    try {
      const [uploadedFile] = await model.upsert(knex, file);
      uploaded.push(uploadedFile.cumulus_id);
    } catch (error) {
      if (!swallowErrors) throw error;
      log.error(`failed up upload file: ${error}`);
    }
  }
  return uploaded;
};

/**
 * add provider through providerPgModel call
 *
 * @param {Knex} knex
 * @returns {Promise<number>}
 */
const loadProvider = async (knex) => {
  const providerJson = fakeProviderRecordFactory({});
  const providerModel = new ProviderPgModel();
  const [{ cumulus_id: providerId }] = await providerModel.upsert(
    knex,
    providerJson
  );
  return providerId;
};

/**
 * add collection collectionPgModel call
 *
 * @param {Knex} knex
 * @param {number} files - number of files per granule
 * @param {number | null} collectionNumber
 * @returns {Promise<number>}
 */
const loadCollection = async (knex, files, collectionNumber = null) => {
  const collectionJson = fakeCollectionRecordFactory({
    files: JSON.stringify((new Array(files)).map((i) => ({
      bucket: `${i}`,
      regex: `^.*${i}$`,
      sampleFileName: `538.${i}`,
    }))),
  });
  if (collectionNumber !== null) {
    collectionJson.name = `DUMMY_${collectionNumber.toString().padStart(3, '0')}`;
  }
  const collectionModel = new CollectionPgModel();
  const [{ cumulus_id: cumulusId }] = await collectionModel.upsert(
    knex,
    collectionJson
  );
  return cumulusId;
};

/**
 * add rule to database
 *
 * @param {Knex} knex
 * @param {number | undefined} collectionCumulusId
 * @param {number | undefined} providerCumulusId
 * @returns {Promise<void>}
 */
const loadRule = async (
  knex,
  collectionCumulusId,
  providerCumulusId
) => {
  const ruleModel = new RulePgModel();
  const rule = fakeRuleRecordFactory(
    {
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
    }
  );
  await ruleModel.upsert(knex, rule);
};

module.exports = {
  loadGranules,
  loadGranulesExecutions,
  loadFiles,
  loadExecutions,
  loadCollection,
  loadProvider,
  loadRule,
};
