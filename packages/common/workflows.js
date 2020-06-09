'use strict';

const templateKey = (stack) => `${stack}/workflow_template.json`;

const workflowTemplateUri = (bucket, stack) => `s3://${bucket}/${templateKey(stack)}`;

const getWorkflowFileKey = (stackName, workflowName) =>
  `${stackName}/workflows/${workflowName}.json`;

const getWorkflowsListKeyPrefix = (stackName) => `${stackName}/workflows/`;

module.exports = {
  getWorkflowFileKey,
  getWorkflowsListKeyPrefix,
  templateKey,
  workflowTemplateUri
};
