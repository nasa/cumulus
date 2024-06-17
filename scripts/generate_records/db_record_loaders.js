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
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded execution
 */
const loadExecutions = async (
  knex,
  collectionCumulusId,
  executionCount,
  model
) => {
  if (executionCount === 0) {
    return [];
  }
  let executionOutputs = [];
  const executions = range(executionCount).map(() => fakeExecutionRecordFactory(
    { collection_cumulus_id: collectionCumulusId }
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
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded granule
 */
const loadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  model
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
 * @returns {Promise<Array<number>>}
 */
const loadFiles = async (
  knex,
  granuleCumulusId,
  fileCount,
  model
) => {
  if (fileCount === 0) {
    return [];
  }
  const files = range(fileCount).map((i) => /** @type {PostgresFile} */(fakeFileRecordFactory({
    bucket: `${i}`,
    granule_cumulus_id: granuleCumulusId,
    key: randomString(8),
  })));
  let uploadedFiles = [];
  uploadedFiles = await model.insert(knex, files);

  return uploadedFiles.map((uploadedFile) => uploadedFile.cumulus_id);
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
