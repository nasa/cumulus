const { newestExecutionArnFromGranuleIdWorkflowName } = require('@cumulus/db');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/lib/executions' });

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
 * @returns {Promise<string>|Promise<undefined>} - executionArn used in a
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

module.exports = { chooseTargetExecution, describeGranuleExecution };
