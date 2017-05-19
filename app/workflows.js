'use strict';

/**
 * Provides access to access ingest workflows running in AWS step functions.
 */

/*eslint no-console: ["error", { allow: ["error"] }] */
const { s3, stepFunctions } = require('./aws');
const yaml = require('js-yaml');
const { BadRequestError, handleError } = require('./api-errors');
const { fromJS, Map, List } = require('immutable');
const WorkflowAggregator = require('./workflow-aggregator');
const { parseExecutionName } = require('./execution-name-parser');

const COLLECTIONS_YAML = 'ingest/collections.yml';

/**
 * getStateMachineArn - Returns the ARN of the state machine for the given stack with the given id.
 *
 * @param  stackName The name of the stack
 * @param  { id }    A workflow with an id.
 * @return ARN of the statemachine in AWS.
 */
const getStateMachineArn = async (stackName, workflowId) => {
  const deployedPrefix = `${stackName}xx${workflowId}`.replace(/-/g, 'x');
  const resp = await stepFunctions().listStateMachines().promise();
  return resp.stateMachines.filter(s => s.name.startsWith(deployedPrefix))[0].stateMachineArn;
};

/**
 * getRunningExecutions - Returns running executions for the workflow
 *
 * @param  stackName     Name of the AWS stack.
 * @param  workflowId    The id of the workflow to look for running executions
 */
const getRunningExecutions = async (stackName, workflowId) => {
  const arn = await getStateMachineArn(stackName, workflowId);
  const resp = await stepFunctions()
    .listExecutions({ stateMachineArn: arn, maxResults: 100, statusFilter: 'RUNNING' })
    .promise();

  if (resp.nextToken) {
    throw new Error(`Found more than 100 running workflows for ${arn}`);
  }
  return List(resp.executions.map((e) => {
    const { collectionId, granuleId } = parseExecutionName(e.name);
    return Map({
      name: e.name,
      start_date: e.startDate,
      collectionId,
      granuleId
    });
  }));
};

/**
 * getCollectionsYaml - Fetches the collections yaml from S3.
 *
 * @param stackName Name of the step functions deployment stack.
 */
const getCollectionsYaml = async (stackName) => {
  try {
    const resp = await s3().getObject(
      { Bucket: `${stackName}-deploy`,
        Key: COLLECTIONS_YAML }).promise();
    return resp.Body.toString();
  }
  catch (error) {
    if (error.code === 'NoSuchBucket') {
      throw new BadRequestError(`Stack name [${stackName}] does not appear to exist`);
    }
    throw error;
  }
};

/**
 * Parses the collection yaml into a Immutable JS javascript object.
 */
const parseCollectionYaml = (collectionsYaml) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar'
  });
  const schema = yaml.Schema.create([resourceType]);
  return fromJS(yaml.safeLoad(collectionsYaml, { schema: schema }));
};

/**
 * getWorkflowStatuses - Returns a list of workflow status results.
 *
 * @param  stackName     The name of the deployed cloud formation stack with AWS state machines.
 */
const getWorkflowStatuses = async (stackName) => {
  const collectionsYaml = await getCollectionsYaml(stackName);
  const parsedYaml = parseCollectionYaml(collectionsYaml);

  const esWorkflowsById = await WorkflowAggregator.loadWorkflowsFromEs();

  const workflowPromises = parsedYaml.get('workflows')
    .entrySeq()
    .map(async ([id, w]) => {
      const name = w.get('Comment');
      const runningExecs = await getRunningExecutions(stackName, id);
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

module.exports = { parseCollectionYaml,
  getStateMachineArn,
  getWorkflowStatuses,
  handleWorkflowStatusRequest };
