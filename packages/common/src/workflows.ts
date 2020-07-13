export const templateKey = (stack: string) => `${stack}/workflow_template.json`;

export const workflowTemplateUri = (bucket: string, stack: string) =>
  `s3://${bucket}/${templateKey(stack)}`;

export const getWorkflowFileKey = (stackName: string, workflowName: string) =>
  `${stackName}/workflows/${workflowName}.json`;

export const getWorkflowsListKeyPrefix = (stackName: string) =>
  `${stackName}/workflows/`;
