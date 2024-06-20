//@ts-check

const pRetry = require('p-retry');

const isNumber = require('lodash/isNumber');

const { newestExecutionArnFromGranuleIdWorkflowName, CollectionPgModel } = require('@cumulus/db');
const {
  getKnexClient,
  batchDeleteExecutionFromDatabaseByCumulusCollectionId,
} = require('@cumulus/db');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { batchDeleteExecutionsByCollection } = require('@cumulus/es-client/executions');
const { defaultIndexAlias } = require('@cumulus/es-client/search');
const { RecordDoesNotExist } = require('@cumulus/errors');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');

const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/lib/executions' });

/**
* @typedef { typeof StepFunctions } StepFunctions
* @typedef { import('knex').Knex } Knex
* @typedef { import('knex').Knex.Transaction } KnexTransaction
* @typedef { import('@cumulus/types/api/collections').CollectionRecord } CollectionRecord
*/

/**
 *  Finds and returns alternative executionArn related to the input granuleId.
 *  Used to override the default (latest) executionArn when reingesting granules.
 *  The decision tree is simple.
 *  1. If a user inputs an executionArn we return it.
 *  2. If not and no workflowName is specified, we return undefined so that the
 *  granule's original execution is retained during reingest.
 *  3. if not and a workflowName is input, we search the database for all
 *  executions that match the granuleId and workflowName and return the most
 *  recent.
 *
 * @param {Object} params - function parameters
 * @param {string} params.granuleId - granuleId
 * @param {string|undefined} [params.executionArn] - execution arn to use for reingest
 * @param {string|undefined} [params.workflowName] - workflow name to use for reingest
 * @param {function|undefined} [params.dbFunction] - database function for
 *     testing. Defaults to executionArnsFromGranuleIdsAndWorkflowNames.
 * @returns {Promise<string | undefined>} - executionArn used in a
 *             granule reingest call to determine correct workflow to run or
 *             undefined.
 */
const chooseTargetExecution = async ({
  granuleId,
  executionArn = undefined,
  workflowName = undefined,
  dbFunction = newestExecutionArnFromGranuleIdWorkflowName,
}) => {
  // if a user specified an executionArn, use that always
  if (executionArn !== undefined) return executionArn;
  // if a user didn't specify a workflow, return undefined explicitly
  if (workflowName === undefined) return undefined;

  try {
    return await dbFunction(granuleId, workflowName);
  } catch (error) {
    log.error(error);
    throw error;
  }
};

/**
 * describeGranuleExecution
 *
 * @param {string} executionArn - The Amazon Resource Name (ARN) of the execution.
 * @param {StepFunctions} [stepFunctionUtils=StepFunctions] - A utility object for
 * interacting with AWS Step Functions.
 * @returns {Promise<StepFunctions.DescribeExecutionOutput | undefined>} A
 * promise that resolves to the description of the execution.
 * @throws {Error} Logs an error if the description of the execution could not be fetched.
 */
async function describeGranuleExecution(executionArn, stepFunctionUtils = StepFunctions) {
  let executionDescription;
  try {
    executionDescription = await stepFunctionUtils.describeExecution({
      executionArn,
    });
  } catch (error) {
    log.error(`Could not describe execution ${executionArn}`, error);
  }
  return executionDescription;
}

/**
 * Retrieves the Cumulus ID of a collection from the database.
 *
 * @param {Knex | KnexTransaction} knex - The Knex client object for interacting with the database.
 * @param {string} apiCollection - The collection object from the API.
 * @returns {Promise<number>} A promise that resolves to the Cumulus ID of the collection.
 * @throws {Error} Throws an error if the collection could not be found in the database.
 */
const _getCollectionCumulusId = async (knex, apiCollection) => {
  const collectionId = deconstructCollectionId(apiCollection);
  const collectionPgModel = new CollectionPgModel();

  log.info(`Querying name: ${collectionId.name}, version: ${collectionId.version}`);
  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(knex, {
      name: collectionId.name,
      version: collectionId.version,
    });
    if (!isNumber(collectionCumulusId)) {
      throw new Error(`Internal Error: Collection ID ${collectionCumulusId} is not a number`);
    }
    log.info(`Collection ID: ${JSON.stringify(collectionCumulusId)}`);
    return collectionCumulusId;
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(`Collection ${collectionId.name} version ${collectionId.version} not found in database`);
    }
    throw error;
  }
};

/**
 * Deletes execution records from the RDS database using
 * batchDeleteExecutionFromDatabaseByCumulusCollectionId.
 *
 * @param {Object} params - The parameters object.
 * @param {Object} params.knex - The Knex client object for interacting with the database.
 * @param {number} params.collectionCumulusId - The ID of the collection whose execution records
 *  are to be deleted.
 * @param {number} params.batchSize - The number of records to delete in each batch.
 * @returns {Promise<number>} A promise that resolves to the number of records deleted.
 * @throws {Error} Throws an error if deletion fails.
 */
const _deleteRdsExecutionsFromDatabase = async ({
  knex,
  collectionCumulusId,
  batchSize,
}) => await pRetry(
  async () => {
    const batchDeleteResult = await batchDeleteExecutionFromDatabaseByCumulusCollectionId({
      knex,
      collectionCumulusId,
      batchSize,
    });
    log.info(
      `Deleted ${batchDeleteResult} execution records from RDS for collection ${collectionCumulusId}`
    );
    return batchDeleteResult;
  },
  {
    retries: 3,
    minTimeout: 60000,
    maxTimeout: 90000,
    onFailedAttempt: (error) => {
      log.warn(`Failed to delete executions: ${error.message}`);
      log.warn(`Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
    },
  }
);

/**
 * Handles the deletion of execution records from both Elasticsearch and the database.
 *
 * @param {Object} event - The event object.
 * @param {string} event.collectionId - The ID of the collection whose execution
 * records are to be deleted.
 * @param {string} event.batchSize - The size of the batches to delete.
 * @returns {Promise<void>}
 */
const batchDeleteExecutionFromDatastore = async (event) => {
  const knex = await getKnexClient();

  const collectionId = event.collectionId;
  const batchSize = Number(event.batchSize) || 100000;

  // Delete ES execution records
  log.info(
    `Starting deletion of executions records from Elasticsearch for collection ${collectionId}`
  );
  await batchDeleteExecutionsByCollection({
    index: process.env.ES_INDEX || defaultIndexAlias,
    collectionId,
    batchSize,
  });

  // Delete RDS execution records
  log.info(
    `Starting deletion of executions records from RDS for collection ${collectionId}z`
  );
  const collectionCumulusId = await _getCollectionCumulusId(knex, collectionId);
  let executionResults = 0;

  // Delete executions from the database in batches
  do {
    // eslint-disable-next-line no-await-in-loop
    executionResults = await _deleteRdsExecutionsFromDatabase({
      knex,
      collectionCumulusId,
      batchSize,
    });
  } while (executionResults > 0);
  log.info(`Execution deletion complete for collection ${collectionId}`);

  // TODO dump summary somewhere?
};

module.exports = {
  batchDeleteExecutionFromDatastore,
  chooseTargetExecution,
  describeGranuleExecution,
};
