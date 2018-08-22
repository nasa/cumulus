/* eslint-disable no-console, no-param-reassign */

'use strict';

const AWS = require('aws-sdk');

const { compact, uniq } = require('lodash');

// Given a stateMachineDefinitionObject, return a list of lambdas
function parseStepFunctionDefinition(stateMachineDefinitionObject) {
  const definition = JSON.parse(stateMachineDefinitionObject.definition);
  return compact(Object.keys(definition.States).map((key) => definition.States[key].Resource));
}

// Given a list of state machine execution ARNs,
// returns qualifed ARN for all lambda resources in use
async function getLambdaResourceArns(executionArnList, sf) {
  const executionPromises = [];
  executionArnList.forEach((arn) => {
    executionPromises.push(sf.describeStateMachineForExecution({ executionArn: arn }).promise());
  });

  let stepFunctionDefinitions;
  try {
    stepFunctionDefinitions = await Promise.all(executionPromises);
  }
  catch (e) {
    console.log('Error resolving step function definitions');
    throw (e);
  }
  const stepFunctionResources = stepFunctionDefinitions.map(
    (definitionObject) => parseStepFunctionDefinition(definitionObject)
  );
  return uniq([].concat(...stepFunctionResources));
}

// For a given executionObject(first page of executions), get all executions
async function getAllExecutions(executionObject, sf2, statusFilter) {
  let executionsList = [];
  let executionsResult;
  const stateMachineArn = executionObject.executions[0].stateMachineArn;
  executionsList = executionsList.concat(
    executionObject.executions.map((execution) => execution.executionArn)
  );

  if (executionObject.nextToken) {
    let nextObject = null;
    try {
      nextObject = await sf2.listExecutions(
        {
          stateMachineArn: stateMachineArn,
          statusFilter: statusFilter,
          nextToken: executionObject.nextToken
        }
      ).promise();
      executionsResult = await getAllExecutions(nextObject, sf2, statusFilter);
    }
    catch (e) {
      console.log('Error querying AWS for executions');
      throw (e);
    }
    executionsList = executionsList.concat(executionsResult);
  }
  return executionsList;
}

// TODO: Docstring
async function getAllActiveLambdaArns(region, deploymentName) {
  AWS.config.update({ region: region });
  const sf = new AWS.StepFunctions();
  const statusFilter = 'RUNNING';

  let executionArnList = [];
  let lambdaResources;

  try {
    // TODO: We should genercize getAllExecutions to get all state machines as well.
    const stateMachinesResults = await sf.listStateMachines({ maxResults: 1000 }).promise();

    // Get list of stateMachines with names matching the current deployment.
    const stateMachines = stateMachinesResults.stateMachines.filter(
      (sm) => sm.name.includes(deploymentName)
    );
    const stateMachineArns = stateMachines.map((x) => x.stateMachineArn);

    // Get a list of 'execution objects', containing the first page of sf.ListExecutions objects
    const listExecutionsPromises = stateMachineArns.map(
      (x) => sf.listExecutions({ stateMachineArn: x, statusFilter: statusFilter }).promise()
    );
    const executionObjects = await Promise.all(listExecutionsPromises);
    const filteredExecutionObjects = executionObjects.filter((x) => x.executions.length > 0);

    // Get all execuions for each execution list header(execution object)
    const feoPromiseList = filteredExecutionObjects.map(
      (feo) => getAllExecutions(feo, sf, statusFilter)
    );

    const allExecutionArns = await Promise.all(feoPromiseList);

    //  For all execution ARNs for all state machines, return a list of unique
    // lambda resource ARNs

    // eslint-disable-next-line array-callback-return
    allExecutionArns.map((x) => {
      executionArnList = executionArnList.concat(x);
    });
    lambdaResources = await getLambdaResourceArns(executionArnList, sf);
  }
  catch (e) {
    // TODO: Add cumulus logging
    console.log(e);
    throw (e);
  }
  return lambdaResources;
}

module.exports = getAllActiveLambdaArns;
