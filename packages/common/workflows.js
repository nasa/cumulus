'use strict';

const { getS3Object } = require('./aws');

const templateKey = (stack) => `${stack}/workflow_template.json`

const workflowTemplateUri = (bucket, stack) => `s3://${bucket}/${templateKey(stack)}`;

/**
 * Get the template JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {Promise.<Object>} template as a JSON object
 */
function getWorkflowTemplate(stackName, bucketName) {
  const key = templateKey(stackName);
  return getS3Object(bucketName, key)
    .then((templateJson) => JSON.parse(templateJson.Body.toString()));
}

/**
 * Get the definition file JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<Object>} template as a JSON object
 */
function getWorkflowFile(stackName, bucketName, workflowName) {
  const key = `${stackName}/workflows/${workflowName}.json`;
  return getS3Object(bucketName, key).then((wfJson) => JSON.parse(wfJson.Body.toString()));
}


/**
 * Get the workflow ARN for the given workflow from the
 * template stored on S3
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<string>} - workflow arn
 */
function getWorkflowArn(stackName, bucketName, workflowName) {
  return getWorkflowFile(stackName, bucketName, workflowName)
    .then((workflow) => workflow.arn);
}

module.exports = {
  getWorkflowArn,
  getWorkflowFile,
  getWorkflowTemplate,
  templateKey,
  workflowTemplateUri
};
