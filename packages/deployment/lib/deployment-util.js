/* eslint-disable no-console, no-param-reassign */

'use strict';

const AWS = require('aws-sdk');

const { compact, uniq } = require('lodash');

/**
 *
 * @param {Object} stateMachineDefinitionObject - an AWS State Machine description
 *                                                object
 * @returns {String[]}} returns an array of lambda ARNs
 */
function parseStepFunctionDefinition(stateMachineDefinitionObject) {
  const definition = JSON.parse(stateMachineDefinitionObject.definition);
  return compact(Object.keys(definition.States).map((key) => definition.States[key].Resource));
}

// Given a list of state machine execution ARNs,
// returns qualifed ARN for all lambda resources in use
/**
 * Returns unique list of lambda ARNs used by executionArns
 *
 * @param {String[]} executionArns - Array of state machine execution ARNs
 * @param {Object} sf - AWS.StepFunctions object
 * @returns {String[]} returns a unique array of lambda ARNs for all of the passed in execution ARNs
 */
async function getLambdaResourceArns(executionArns, sf) {
  const executionPromises = [];
  executionArns.forEach((arn) => {
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

/**
 * Given a 'first page' sf.listExecutions object, recursively get
 * each following page of objects. Returns an array of execution ARNs
 *
 * @param {Object} executionObject - aws sf.listExecutions object.
/* @param {Object} sf AWS.StepFunctions object
 * @param {String} statusFilter - listExecutions 'status filter' string to filter results on
 * @returns{String} returns a list of executionARNs for the passed in executionObject and all
 *                  following calls
 */
async function getAllExecutions(executionObject, sf, statusFilter) {
  let executionsList = [];
  let executionsResult;
  const stateMachineArn = executionObject.executions[0].stateMachineArn;
  executionsList = executionsList.concat(
    executionObject.executions.map((execution) => execution.executionArn)
  );

  if (executionObject.nextToken) {
    let nextObject = null;
    try {
      nextObject = await sf.listExecutions(
        {
          stateMachineArn: stateMachineArn,
          statusFilter: statusFilter,
          nextToken: executionObject.nextToken
        }
      ).promise();
      executionsResult = await getAllExecutions(nextObject, sf, statusFilter);
    }
    catch (e) {
      console.log('Error querying AWS for executions');
      throw (e);
    }
    executionsList = executionsList.concat(executionsResult);
  }
  return executionsList;
}


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
    console.log(e);
    throw (e);
  }
  return lambdaResources;
}

module.exports = getAllActiveLambdaArns;
