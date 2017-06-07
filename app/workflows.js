'use strict';

/**
 * Provides access to access ingest workflows running in AWS step functions.
 */

/*eslint no-console: ["error", { allow: ["error"] }] */
const { stepFunctions } = require('./aws');
const { handleError } = require('./api-errors');
const { fromJS, Map, List } = require('immutable');
const ExecutionAggregator = require('./execution-aggregator');
const { loadCollectionConfig } = require('./collection-config');
const { parseExecutionName } = require('./execution-name-parser');


/**
 * Helper function for converting a workflow id to ARN.
 */
const workflowIdToArn = async (stackName, id) => {
  const collectionConfig = await loadCollectionConfig(stackName);
  const workflow = collectionConfig.get('_workflow_meta').filter(w => w.get('id') === id).first();
  return workflow ? workflow.get('arn') : null;
};

/**
 * getRunningExecutions - Returns running executions for the workflow
 */
const getRunningExecutions = async (stackName, workflowArn) => {
  const resp = await stepFunctions()
    .listExecutions({ stateMachineArn: workflowArn, maxResults: 100, statusFilter: 'RUNNING' })
    .promise();

  if (resp.nextToken) {
    throw new Error(`Found more than 100 running workflows for ${workflowArn}`);
  }
  return List(resp.executions.map((e) => {
    const { collectionId, granuleId, uuid } = parseExecutionName(e.name);
    return Map({
      arn: e.executionArn,
      name: e.name,
      startDate: e.startDate,
      collectionId,
      granuleId,
      uuid
    });
  }));
};

/**
 * getWorkflowStatuses - Returns a list of workflow status results.
 *
 * @param  stackName     The name of the deployed cloud formation stack with AWS state machines.
 */
const getWorkflowStatuses = async (stackName) => {
  const collectionConfig = await loadCollectionConfig(stackName);
  const esWorkflowsById = await ExecutionAggregator.loadWorkflowsFromEs();

  const workflowPromises = collectionConfig.get('_workflow_meta')
    .map(async (w) => {
      const { id, name, arn } = w.toJS();
      const runningExecs = await getRunningExecutions(stackName, arn);
      const runningExecsByCollection = runningExecs.groupBy(e => e.get('collectionId'));
      let workflow = fromJS(esWorkflowsById[id] || { id: id });
      workflow = workflow.set('name', name);
      return workflow.updateIn(['products'], products =>
        (products || List()).map((product) => {
          const running = runningExecsByCollection.get(product.get('id'), List());
          return product.set('num_running', running.count());
        })
      );
    });
  return List(await Promise.all(workflowPromises.toArray()));
};

/**
 * handleWorkflowStatusRequest - Handles the API request for workflow statuses.
 */
const handleWorkflowStatusRequest = async (req, res) => {
  try {
    req.checkQuery('stack_name', 'Invalid stack_name').notEmpty();
    const result = await req.getValidationResult();
    if (!result.isEmpty()) {
      res.status(400).json(result.array());
    }
    else {
      const stackName = req.query.stack_name;
      const statuses = await getWorkflowStatuses(stackName);
      res.json(statuses.toJS());
    }
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = {
  getWorkflowStatuses,
  getRunningExecutions,
  workflowIdToArn,
  handleWorkflowStatusRequest };
