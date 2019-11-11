'use strict';

const { getS3Object, listS3ObjectsV2 } = require('./aws');

const templateKey = (stack) => `${stack}/workflow_template.json`;

const workflowTemplateUri = (bucket, stack) => `s3://${bucket}/${templateKey(stack)}`;

/**
 * Get the template JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {Promise.<Object>} template as a JSON object
 */
async function getWorkflowTemplate(stackName, bucketName) {
  const key = templateKey(stackName);
  const templateJson = await getS3Object(bucketName, key);
  return JSON.parse(templateJson.Body.toString());
}

/**
 * Get the definition file JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<Object>} definition file as a JSON object
 */
async function getWorkflowFile(stackName, bucketName, workflowName) {
  const key = `${stackName}/workflows/${workflowName}.json`;
  const wfJson = await getS3Object(bucketName, key);
  return JSON.parse(wfJson.Body.toString());
}


/**
 * Get the workflow ARN for the given workflow from the
 * template stored on S3
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<string>} workflow arn
 */
async function getWorkflowArn(stackName, bucketName, workflowName) {
  const workflow = await getWorkflowFile(stackName, bucketName, workflowName);
  return workflow.arn;
}

/**
 * Get S3 object
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 *
 * @returns {Promise.<Array>} list of workflows
 */
async function getWorkflowList(stackName, bucketName) {
  const workflowsListKey = `${stackName}/workflows/`;
  const workflows = await listS3ObjectsV2({
    Bucket: bucketName,
    Prefix: workflowsListKey
  });
  return Promise.all(workflows.map((obj) => getS3Object(bucketName, obj.Key)
    .then((r) => JSON.parse(r.Body.toString()))));
}

module.exports = {
  getWorkflowArn,
  getWorkflowFile,
  getWorkflowList,
  getWorkflowTemplate,
  templateKey,
  workflowTemplateUri
};
