const { s3 } = require('./aws');

/**
 * Get the template JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {Promise.<Object>} template as a JSON object
 */
function getWorkflowTemplate(stackName, bucketName) {
  const key = `${stackName}/workflows/template.json`;
  return s3().getObject({ Bucket: bucketName, Key: key }).promise()
    .then((templateJson) => JSON.parse(templateJson.Body.toString()));
}


/**
 * Get the list of workflows for the deployment
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {Promise.<Array>} list of workflows as a JSON array
 */
function getWorkflowList(stackName, bucketName) {
  const key = `${stackName}/workflows/list.json`;
  return s3().getObject({ Bucket: bucketName, Key: key }).promise()
    .then((templateJson) => JSON.parse(templateJson.Body.toString()));
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
  return getWorkflowList(stackName, bucketName)
    .then((list) => {
      const match = list.filter((wf) => wf.name === workflowName);
      if (match.length > 1) throw new Error(`Found more than one workflow with name ${workflowName}!`);
      if (match.length === 0) throw new Error(`Found no workflows with name ${workflowName}!`);
      return match[0].arn;
    });
}

module.exports = {
  getWorkflowArn,
  getWorkflowList,
  getWorkflowTemplate
};
