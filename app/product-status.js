'use strict';

/**
 * Implements functions for retrieving product execution status
 */

/*eslint no-console: ["error", { allow: ["error"] }] */

const { stepFunctions } = require('./aws');
const { handleError } = require('./api-errors');
const ExecutionAggregator = require('./execution-aggregator');
const Workflows = require('./workflows');

/**
 * Returns product status info for the given collection.
 */
const getProductStatus = async (stackName, workflowId, collectionId, numExecutions) => {
  // Get the currently running executions
  const runningExecs = await Workflows.getRunningExecutions(stackName, workflowId);
  const runningExecsForColl = runningExecs.filter(e => e.get('collectionId') === collectionId);

  // Figure out which state each of the running executions is on.
  const runningPromises = runningExecsForColl.map(async (exec) => {
    const history = await stepFunctions().getExecutionHistory({ executionArn: exec.get('arn') })
      .promise();
    // The last entered state will contain the current task.
    const enteredEvents = history.events.reverse().filter(e => e.type.endsWith('Entered'));
    let currentState = null;
    if (enteredEvents.length > 0) {
      currentState = enteredEvents[0].stateEnteredEventDetails.name;
    }
    return {
      start_date: exec.get('startDate'),
      granule_id: exec.get('granuleId'),
      current_state: currentState
    };
  }).toJS();

  const [runningExecsWithState, productStatus] = await Promise.all([
    Promise.all(runningPromises),
    ExecutionAggregator.getCollectionCompletedExecutions(workflowId, collectionId, numExecutions)
  ]);

  return {
    running_executions: runningExecsWithState.slice(0, numExecutions),
    completed_executions: productStatus.executions,
    performance: productStatus.performance
  };
};

/**
 * handleProductStatusRequest - Handles the API request for product status.
 */
const handleProductStatusRequest = async (req, res) => {
  try {
    req.checkQuery('stack_name', 'Invalid stack_name').notEmpty();
    req.checkQuery('workflow_id', 'Invalid workflow_id').notEmpty();
    req.checkQuery('collection_id', 'Invalid collection_id').notEmpty();
    req.checkQuery('num_executions', 'Invalid num_executions').isInt({ min: 1, max: 1000 });
    const result = await req.getValidationResult();
    if (!result.isEmpty()) {
      res.status(400).json(result.array());
    }
    else {
      const stackName = req.query.stack_name;
      const workflowId = req.query.workflow_id;
      const collectionId = req.query.collection_id;
      const numExecutions = req.query.num_executions;
      const status = await getProductStatus(stackName, workflowId, collectionId, numExecutions);
      res.json(status);
    }
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = {
  getProductStatus,
  handleProductStatusRequest };
