'use strict';

const aws = require('./aws');
const uuid = require('uuid');

/**
 * Constructs the input to pass to the step functions to kick off ingest. The execution name
 * that should be used is returned in ingest_meta.execution_name.
 */
const constructStepFunctionInput = (resources, provider, collection) => {
  const stateMachine = collection.workflow;
  const meta = JSON.parse(JSON.stringify(collection.meta || {}));
  const startDate = new Date().toISOString();
  const id = uuid.v4();
  const executionName = aws.toSfnExecutionName([collection.id, id], '__');
  return {
    workflow_config_template: collection.workflow_config_template,
    resources: resources,
    provider: provider,
    ingest_meta: {
      message_source: 'sfn',
      start_date: startDate,
      state_machine: stateMachine,
      execution_name: executionName,
      id: id
    },
    meta: meta,
    exception: 'None',
    payload: null
  };
};

module.exports = {
  constructStepFunctionInput
};
