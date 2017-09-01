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
 * getRunningExecutions - Returns running executions for the workflow
 */
const getRunningExecutions = async (stackName, workflowArn) => {
  const resp = await stepFunctions()
    .listExecutions({ stateMachineArn: workflowArn, maxResults: 100, statusFilter: 'RUNNING' })
    .promise();

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
    const stackName = process.env.STACK_NAME;
    const statuses = await getWorkflowStatuses(stackName);
    res.json(statuses.toJS());
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = {
  getWorkflowStatuses,
  getRunningExecutions,
  handleWorkflowStatusRequest
};
