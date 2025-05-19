'use strict';

const fs = require('fs-extra');
const jsyaml = require('js-yaml');

const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const { cf } = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { getWorkflowFileKey } = require('@cumulus/common/workflows');

const {
  loadConfig,
  runKes,
} = require('../../helpers/testUtils');

xdescribe('When the useWorkflowLambdaVersions option is set to false the deployment', () => {
  let config;
  let lambdaVersionStackName;
  let stackList;
  let startDate;
  let workflowDefinitions;

  beforeAll(async () => {
    config = await loadConfig();

    const deletedStatuses = ['DELETE_COMPLETE'];
    lambdaVersionStackName = `${config.stackName}-WorkflowLambdaVersionsNestedStack`;
    startDate = new Date();

    await runKes(config);

    // Redeploy with custom configuration
    try {
      await fs.copy('node_modules/@cumulus/deployment/app', 'test_app');
      const configString = await fs.readFile('./test_app/config.yml', 'utf-8');
      const updatedConfig = configString.replace(/useWorkflowLambdaVersions: true/, 'useWorkflowLambdaVersions: false/');
      await fs.writeFile('./test_app/config.yml', updatedConfig, 'utf-8');

      await runKes(config, {
        template: 'test_app/',
        kesClass: 'node_modules/@cumulus/deployment/app/kes.js',
      });
    } finally {
      await fs.remove('test_app');
    }

    const workflows = jsyaml.load(await fs.readFile('workflows.yml'));

    // Get the definition for all workflows
    const defPromises = Object.keys(workflows).map(async (workflow) => {
      const { arn: workflowArn } = await getJsonS3Object(
        config.bucket,
        getWorkflowFileKey(config.stackName, workflow)
      );
      const stateMachine = await StepFunctions.describeStateMachine({ stateMachineArn: workflowArn });
      return stateMachine.definition;
    });
    workflowDefinitions = await Promise.all(defPromises);

    //get a list of completed stacks
    stackList = await cf().listStacks({ StackStatusFilter: deletedStatuses }).promise();
  });

  afterAll(() => runKes(config));

  it('has no alias references in any workflow', () => {
    const allStates = workflowDefinitions.map((def) => jsyaml.load(def).States);
    let resources = [];
    //Unqualified lambda ARNs have 6 stanzas, qualified have 7
    const regex = /^([^:]*:){7,}[^:]+$/;
    for (let i = 0; i < allStates.length; i += 1) {
      const keys = Object.keys(allStates[i]);
      const filteredKeys = keys.filter((key) => allStates[i][key].Type === 'Task');
      resources = resources.concat(filteredKeys.map((key) => allStates[i][key].Resource));
    }
    const actual = resources.filter((resource) => resource.match(regex));
    expect(actual.length).toEqual(0);
  });

  it('has removed the lambdaVersionStack', () => {
    const matchingStacks = stackList.StackSummaries.filter((stack) => stack.StackName.includes(lambdaVersionStackName));
    const newlyDeletedStacks = matchingStacks.filter((stack) => stack.DeletionTime > startDate);
    expect(newlyDeletedStacks.length).toEqual(1);
  });
});
