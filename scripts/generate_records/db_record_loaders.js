// @ts-check

/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */

const fs = require('fs-extra');

const Logger = require('@cumulus/logger');
const {
  CollectionPgModel,
  ProviderPgModel,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  fakeExecutionRecordFactory,
  fakeRuleRecordFactory,
  translateApiProviderToPostgresProvider,
  translateApiCollectionToPostgresCollection,
  RulePgModel,
} = require('@cumulus/db');

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
 * @returns {Promise<string>}
 */
const loadProvider = async (knex) => {
  const providerJson = JSON.parse(fs.readFileSync(`${__dirname}/resources/s3_provider.json`, 'utf8'));
  const providerModel = new ProviderPgModel();
  const [{ name: providerId }] = await providerModel.upsert(
    knex,
    await translateApiProviderToPostgresProvider(providerJson)
  );
  return providerId;
};

/**
 * add collection collectionPgModel call
 *
 * @param {Knex} knex
 * @param {string} collectionName
 * @param {number} files - number of files per granule
 * @returns {Promise<PostgresCollection>}
 */
const loadCollection = async (knex, collectionName, files) => {
  const collectionJson = JSON.parse(fs.readFileSync(`${__dirname}/resources/collections/s3_MOD09GQ_006.json`, 'utf8'));
  collectionJson.name = collectionName;
  collectionJson.files = (new Array(files)).map((i) => ({
    bucket: `${i}`,
    regex: `^.*${i}$`,
    sampleFileName: `538.${i}`,
  }));
  const collectionModel = new CollectionPgModel();
  await collectionModel.upsert(
    knex,
    translateApiCollectionToPostgresCollection(collectionJson)
  );
  return collectionJson;
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
