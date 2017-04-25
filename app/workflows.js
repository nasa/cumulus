'use strict';

/*eslint no-console: ["error", { allow: ["error"] }] */

/**
 * TODO describe this file
 */

const { s3, stepFunctions } = require('./aws');
const yaml = require('js-yaml');
const { fromJS, Map } = require('immutable');

const COLLECTIONS_YAML = 'ingest/collections.yml';

/**
 * getStateMachineArn - Returns the ARN of the state machine for the given stack with the given id.
 *
 * @param  stackName The name of the stack
 * @param  { id }    A workflow with an id.
 * @return ARN of the statemachine in AWS.
 */
async function getStateMachineArn(stackName, { id }) {
  const deployedPrefix = `${stackName}xx${id}`.replace(/-/g, 'x');
  const resp = await stepFunctions.listStateMachines().promise();
  return resp.stateMachines.filter(s => s.name.startsWith(deployedPrefix))[0].stateMachineArn;
}

/**
 * getExecutions - Returns the most recent executions of the given workflow
 *
 * @param  stackName     Name of the AWS stack.
 * @param  workflow      The workflow containing an id
 * @param  numExecutions The number of executions to return at most.
 * @return a list of executions for the workflow with status and start and stop dates.
 */
async function getExecutions(stackName, workflow, numExecutions) {
  const arn = await getStateMachineArn(stackName, workflow);
  const resp = await stepFunctions
    .listExecutions({ stateMachineArn: arn, maxResults: numExecutions })
    .promise();

  const executions = resp.executions;
  return executions.map(e => (
    { status: e.status,
      start_date: e.startDate,
      stop_date: e.stopDate }));
}

/**
 * getCollectionsYaml - TODO
 *
 * @param  {type} stackName description
 * @return {type}           description
 */
async function getCollectionsYaml(stackName) {
  const resp = await s3.getObject(
    { Bucket: `${stackName}-deploy`,
      Key: COLLECTIONS_YAML }).promise();
  return resp.Body.toString();
}

/**
 * TODO
 */
const parseCollectionYaml = (collectionsYaml) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar'
  });
  const schema = yaml.Schema.create([resourceType]);
  return fromJS(yaml.safeLoad(collectionsYaml, { schema: schema }));
};


/* eslint-disable */
const sampleCollYaml = () => {
  const fs = require('fs');
  return parseCollectionYaml(fs.readFileSync('../test/sample-collections.yml', 'UTF-8'));
};
/* eslint-enable */


/**
 * getWorkflowStatuses - description
 *
 * @param  stackName     description
 * @param  numExecutions description
 * @return               description
 */
async function getWorkflowStatuses(stackName, numExecutions) {
  const collectionsYaml = await getCollectionsYaml(stackName);
  const parsedYaml = parseCollectionYaml(collectionsYaml);

  // const parsedYaml = sampleCollYaml();

  const workflows = parsedYaml.get('workflows')
    .entrySeq()
    .map(([k, v]) => Map({ id: k, name: v.get('Comment') }));

  // Request the executions for each workflow. We don't do separate waiting so that they'll
  // execute in parallel.
  const executionPromises = workflows.map(w => getExecutions(stackName, w, numExecutions));
  // We use Promise.all to wait on all of the parallel requests.
  const executionArrays = await Promise.all(executionPromises);

  return workflows.map((w, idx) => {
    const executions = executionArrays[idx];
    return w.set('executions', executions);
  });
}

/**
 * handleWorkflowsRequest - TODO
 *
 * @param  {type} req description
 * @param  {type} res description
 * @return {type}     description
 */
function handleWorkflowsRequest(req, res) {
  const stackName = req.query.stack_name;
  const numExecutions = req.query.num_executions;

  // TODO validate that params are present
  // TODO handle stack name not existing
  getWorkflowStatuses(stackName, numExecutions)
  .then((statuses) => {
    res.json(statuses.toJS());
  })
  .catch((err) => {
    console.error(err.stack);
    res.status(500).json({ errors: ['An internal error has occured.'] });
  });
}

module.exports = { handleWorkflowsRequest };
