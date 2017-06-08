'use strict';

/**
 * Implements functions for retrieving product execution status
 */

/*eslint no-console: ["error", { allow: ["error"] }] */

const { stepFunctions } = require('./aws');
const { handleError } = require('./api-errors');
const { Map } = require('immutable');
const ExecutionAggregator = require('./execution-aggregator');
const ExecutionIndexer = require('./execution-indexer');
const Workflows = require('./workflows');
const { loadCollectionConfig } = require('./collection-config');


/**
 * TODO
 */
const getArnAndParentArn = async (stackName, workflowId) => {
  const collectionConfig = await loadCollectionConfig(stackName);
  const findWorkflowById = id =>
    collectionConfig.get('_workflow_meta').filter(w => w.get('id') === id).first();
  const workflow = findWorkflowById(workflowId);
  if (workflow) {
    const parentId = workflow.get('parent');
    const parentArn = parentId ? findWorkflowById(parentId).get('arn') : null;
    return [workflow.get('arn'), parentArn];
  }
  return null;
};


/**
 * Gets running executions for the given workflowArn. Returns empty list if workflowArn is null.
 */
const getRunningExecutions = async (stackName, workflowArn, collectionId) => {
  if (!workflowArn) {
    return [];
  }
  const runningExecs = await Workflows.getRunningExecutions(stackName, workflowArn);
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
      uuid: exec.get('uuid'),
      start_date: exec.get('startDate'),
      granule_id: exec.get('granuleId'),
      current_state: currentState
    };
  }).toJS();
  return Promise.all(runningPromises);
};

// The reason to use with an execution from reingesting.
const REINGEST_REASON = 'Manual Reingest';

// The reason to use with an execution from a non-reingest run..
const TRIGGER_REASON = 'Timer';

/**
 * Returns product status info for the given collection.
 */
const getProductStatus = async (stackName, workflowId, collectionId, numExecutions) => {
  // Get the currently running executions
  const [workflowArn, parentArn] = await getArnAndParentArn(stackName, workflowId);
  const [runningExecs, parentRunningExecs, completedProductStatus] = await Promise.all([
    getRunningExecutions(stackName, workflowArn, collectionId),
    getRunningExecutions(stackName, parentArn, collectionId),
    ExecutionAggregator.getCollectionCompletedExecutions(workflowId, collectionId, numExecutions)
  ]);

  const completedExecs = completedProductStatus.executions;

  const executionUUIDs = runningExecs.concat(parentRunningExecs, completedExecs).map(e => e.uuid);
  const reingestExecs = await ExecutionIndexer.findReingestExecsByUUIDs(executionUUIDs);
  const uuidToReingestExec = reingestExecs.reduce((m, e) => m.set(e.get('uuid'), e), Map());

  const addReason = (e) => {
    if (uuidToReingestExec.has(e.uuid)) {
      e.reason = REINGEST_REASON;
    }
    else {
      e.reason = TRIGGER_REASON;
    }
  };
  runningExecs.map(addReason);
  completedExecs.map(addReason);
  // Keep only the parent executions which are being run for a reingest.
  const parentExecsForReturn = parentRunningExecs.filter(e => uuidToReingestExec.has(e.uuid))
    .map(({ start_date, uuid, current_state }) => ({
      start_date,
      uuid,
      current_state,
      reason: REINGEST_REASON,
      granule_id: uuidToReingestExec.getIn([uuid, 'granuleId'])
    }));

  return {
    running_executions: parentExecsForReturn.concat(runningExecs),
    completed_executions: completedExecs,
    performance: completedProductStatus.performance
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
