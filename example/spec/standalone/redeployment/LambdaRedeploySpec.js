'use strict';

const {
  buildAndStartWorkflow,
  getLambdaAliases,
  getLambdaVersions,
  waitForCompletedExecution,
  LambdaStep
} = require('@cumulus/integration-tests');

const fs = require('fs-extra');
const {
  loadConfig,
  protectFile,
  redeploy
} = require('../../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

describe('When a workflow is running and a new version of a workflow lambda is deployed', () => {
  let workflowExecutionArn;
  let workflowStatus;
  let testVersionOutput;

  let startVersions;
  let endVersions;
  let startAliases;
  let endAliases;
  let startVersionNumbers;
  let endVersionNumbers;
  let startAliasVersionNumbers;
  let endAliasVersionNumbers;

  const lambdaFile = './lambdas/versionUpTest/index.js';

  const lambdaName = `${config.prefix}-VersionUpTest`;

  beforeAll(async () => {
    await protectFile(lambdaFile, async () => {
      await fs.appendFile(lambdaFile, `// ${new Date()}`);
      await redeploy(config);
    });

    startVersions = await getLambdaVersions(lambdaName);
    startAliases = await getLambdaAliases(lambdaName);

    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName,
      config.bucket,
      'TestLambdaVersionWorkflow'
    );

    await protectFile(lambdaFile, async () => {
      await fs.appendFile(lambdaFile, `// ${new Date()}`);
      await redeploy(config);
    });

    workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
    testVersionOutput = await lambdaStep.getStepOutput(
      workflowExecutionArn,
      lambdaName
    );

    endVersions = await getLambdaVersions(lambdaName);
    endAliases = await getLambdaAliases(lambdaName);
    endVersionNumbers = endVersions.map((x) => x.Version).filter((x) => (x !== '$LATEST'));
    startVersionNumbers = startVersions.map((x) => x.Version).filter((x) => (x !== '$LATEST'));
    endAliasVersionNumbers = endAliases.map((x) => x.FunctionVersion);
    startAliasVersionNumbers = startAliases.map((x) => x.FunctionVersion);
  });

  it('the workflow executes successfully', () => {
    expect(workflowStatus).toEqual('SUCCEEDED');
  });

  it('uses the original software version', () => {
    expect(testVersionOutput.payload).toEqual({ output: 'Current Version' });
  });

  it('creates a new Lambda Version', () => {
    expect(Math.max(...endVersionNumbers) - Math.max(...startVersionNumbers)).toEqual(1);
  });

  it('creates an updated Alias', () => {
    expect(Math.max(...endAliasVersionNumbers) - Math.max(...startAliasVersionNumbers)).toEqual(1);
  });

  it('creates aliases for all deployed versions', () => {
    expect(endAliasVersionNumbers.sort()).toEqual(endVersionNumbers.sort());
  });
});
