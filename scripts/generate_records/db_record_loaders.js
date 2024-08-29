// @ts-check

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
const range = require('lodash/range');
const { randomInt } = require('crypto');

/**
 * @typedef {import('@cumulus/db').PostgresFile} PostgresFile
 * @typedef {import('@cumulus/db').PostgresGranule} PostgresGranule
 * @typedef {import('@cumulus/db').PostgresCollection} PostgresCollection
 * @typedef {import('@cumulus/db').GranulesExecutionsPgModel} GranulesExecutionsPgModel
 * @typedef {import('@cumulus/db').ExecutionPgModel} ExecutionPgModel
 * @typedef {import('@cumulus/db').GranulePgModel} GranulePgModel
 * @typedef {import('@cumulus/db').FilePgModel} FilePgModel
 * @typedef {import('@cumulus/db').PostgresGranuleExecution} PostgresGranuleExecution
 * @typedef {import('@cumulus/db/dist/types/granule').GranuleStatus} GranuleStatus
 * @typedef {import('@cumulus/db').PostgresExecution} PostgresExecution
 * @typedef {import('@cumulus/db').PostgresRule} PostgresRule
 * @typedef {import('@cumulus/db').PostgresProvider} PostgresProvider
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
 * @param {Partial<PostgresExecution>} params
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded execution
 */
const loadExecutions = async (
  knex,
  collectionCumulusId,
  executionCount,
  model,
  params = {}
) => {
  if (executionCount === 0) {
    return [];
  }
  let executionOutputs = [];
  const executions = range(executionCount).map(() => fakeExecutionRecordFactory(
    {
      collection_cumulus_id: collectionCumulusId,
      ...params,
    }
  ));
  executionOutputs = await model.insert(knex, executions);

  return executionOutputs.map((executionOutput) => executionOutput.cumulus_id);
};

/**
 * upload granuleExecutions corresponding to each pair
 * within list of granuleCumulusIds and executionCumulusIds
 *
 * @param {Knex} knex
 * @param {Array<number>} granuleCumulusIds
 * @param {Array<number>} executionCumulusIds
 * @param {GranulesExecutionsPgModel} model
 * @returns {Promise<Array<PostgresGranuleExecution>>} - granuleExecutions
 */
const loadGranulesExecutions = async (
  knex,
  granuleCumulusIds,
  executionCumulusIds,
  model
) => {
  if (granuleCumulusIds.length === 0 || executionCumulusIds.length === 0) {
    return [];
  }
  const granulesExecutions = granuleCumulusIds.map((granuleCumulusId) => (
    executionCumulusIds.map((executionCumulusId) => (
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    ))
  )).flat();

  return await model.insert(knex, granulesExecutions);
};

/**
 * upload granules corresponding to collection with collectionCumulusId
 *
 * @param {Knex} knex
 * @param {number} collectionCumulusId
 * @param {number} providerCumulusId
 * @param {number} granuleCount
 * @param {GranulePgModel} model
 * @param {Partial<PostgresGranule>} params
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded granule
 */
const loadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  model,
  params = {}
) => {
  if (granuleCount === 0) {
    return [];
  }
  let granuleOutputs = [];
  const granules = range(granuleCount).map(() => /** @type {PostgresGranule} */(
    fakeGranuleRecordFactory({
      granule_id: randomString(7),
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      status: /** @type {GranuleStatus} */(['completed', 'failed', 'running', 'queued'][randomInt(4)]),
      ...params,
    })
  ));
  granuleOutputs = await model.insert(knex, granules);

  return granuleOutputs.map((g) => g.cumulus_id);
};

/**
 * upload files corresponding to granule with granuleCumulusId
 *
 * @param {Knex} knex
 * @param {number} granuleCumulusId
 * @param {number} fileCount
 * @param {FilePgModel} model
 * @param {Partial<PostgresFile>} params
 * @returns {Promise<Array<number>>}
 */
const loadFiles = async (
  knex,
  granuleCumulusId,
  fileCount,
  model,
  params = {}
) => {
  if (fileCount === 0) {
    return [];
  }
  const files = range(fileCount).map((i) => /** @type {PostgresFile} */(fakeFileRecordFactory({
    bucket: `${i}`,
    granule_cumulus_id: granuleCumulusId,
    key: randomString(8),
    ...params,
  })));
  let uploadedFiles = [];
  uploadedFiles = await model.insert(knex, files);

  return uploadedFiles.map((uploadedFile) => uploadedFile.cumulus_id);
};

/**
 * add provider through providerPgModel call
 *
 * @param {Knex} knex
 * @param {Partial<PostgresProvider>} params
 * @returns {Promise<number>}
 */
const loadProvider = async (knex, params = {}) => {
  const providerJson = fakeProviderRecordFactory(params);
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
 * @param {Partial<PostgresCollection>} params
 * @returns {Promise<number>}
 */
const loadCollection = async (knex, files, collectionNumber = null, params = {}) => {
  const collectionJson = fakeCollectionRecordFactory({
    files: JSON.stringify((range(files)).map((i) => (
      {
        bucket: `${i}`,
        regex: `^.*${i}$`,
        sampleFileName: `538.${i}`,
      }
    ))),
    ...params,
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
 * @param {Partial<PostgresRule>} params
 * @returns {Promise<number>}
 */
const loadRule = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  params
) => {
  const ruleModel = new RulePgModel();
  const rule = fakeRuleRecordFactory(
    {
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      ...params,
    }
  );
  const [{ cumulusId }] = await ruleModel.upsert(knex, rule);
  return cumulusId;
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
