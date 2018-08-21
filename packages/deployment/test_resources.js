/* eslint-disable no-console, no-param-reassign */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const utils = require('kes').utils;
const yauzl = require('yauzl');
const AWS = require('aws-sdk');

const { compact, uniq } = require('lodash');
const { Lambda } = require('kes');


async function getAllActiveLambdaResources() {
  // TODO: Pull this from config
  AWS.config.update({region: 'us-east-1'});
  const sf = new AWS.StepFunctions();
  let filteredExecutionObjects = [];
  let executionArnList = [];
  let lambdaResources;

  try {
    // TODO: Genercize getAllExecutions to get all state machines if needed.
    let stateMachinesResults = await sf.listStateMachines({maxResults: 1000}).promise();
    // TODO: use defined deployment name here, once we know where to integrate
    let stateMachines = stateMachinesResults.stateMachines.filter(sm => sm.name.includes('jkCumulus'));
    let stateMachineArns = stateMachines.map(x => x.stateMachineArn);
    let listExecutionsPromises = stateMachineArns.map(x => sf.listExecutions({stateMachineArn: x, statusFilter: 'RUNNING'}).promise());
    let executionObjects = await Promise.all(listExecutionsPromises);
    // Filter objects with no executions.   We could -probably- do this in get all executions.
    executionObjects.map(x => {if(x.executions.length > 0) filteredExecutionObjects.push(x);});
    let feoPromiseList = filteredExecutionObjects.map(feo => getAllExecutions(feo, sf));
    let allExecutionArns = await Promise.all(feoPromiseList);
    allExecutionArns.map(x => {executionArnList = executionArnList.concat(x);});
    lambdaResources = await getLambdaResourceArns(executionArnList, sf);
  } catch (e) {
    console.log(e);
    throw(e);
  }
  return lambdaResources;
}

// Given an execution list from above, returns unique lambda resources in use
async function getLambdaResourceArns(executionArnList, sf) {
  let lambdaResourceArns = [];
  let executionPromises = [];
  console.log(`executionArnList is ${executionArnList}`);
  executionArnList.forEach((arn) => {
    executionPromises.push(sf.describeStateMachineForExecution({executionArn: arn}).promise());
  });

  let stepFunctionDefinitions = await Promise.all(executionPromises);
  console.log(`Step FunctionDefinitions are ${JSON.stringify(stepFunctionDefinitions)}`);
  let stepFunctionResources = stepFunctionDefinitions.map(definitionObject => parseStepFunctionDefinition(definitionObject));
  return uniq([].concat.apply([], stepFunctionResources));
}

// Given a stateMachineDefinitionObject, return a list of lambdas in use
function parseStepFunctionDefinition(stateMachineDefinitionObject) {
  let definition = JSON.parse(stateMachineDefinitionObject.definition);
  return compact(Object.keys(definition.States).map(key => definition.States[key].Resource));
}

// For a given executionObject(first page of executions), get all executions
async function getAllExecutions(executionObject, sf2) {
  let executionsList = [];
  let stateMachineArn = executionObject.executions[0].stateMachineArn;
  executionsList = executionsList.concat(executionObject.executions.map(execution => execution.executionArn));
  if(executionObject.nextToken) {
    let nextObject = null;
    try {
      nextObject = await sf2.listExecutions({stateMachineArn: stateMachineArn, statusFilter: 'RUNNING', nextToken: executionObject.nextToken}).promise();
    } catch (e) {
      console.log(`Error in listExecutionsQuery:  ${e}`);
      throw(e);
    }
    let executionsResult = await getAllExecutions(nextObject, sf2);
    let executionList = executionsList.concat(executionsResult);
  }
  return executionsList;
}

module.exports = getAllActiveLambdaResources;
