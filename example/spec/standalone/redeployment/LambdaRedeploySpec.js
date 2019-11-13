'use strict';

const execa = require('execa');
const path = require('path');
const { getExecutionHistory } = require('@cumulus/common/StepFunctions');
const {
  buildAndStartWorkflow,
  getLambdaAliases,
  getLambdaVersions,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const fs = require('fs-extra');
const {
  loadConfig,
  protectFile
} = require('../../helpers/testUtils');

const terraformApply = (versioning = true) => {
  const versioningArgs = versioning ?
    ['-var', 'enable_task_versioning=true'] :
    [];

  return execa(
    'terraform',
    ['apply', '-auto-approve', ...versioningArgs],
    {
      cwd: path.join(process.cwd(), 'cumulus-tf'),
      stdout: process.stdout,
      stderr: process.stderr
    }
  );
};

const buildZip = () =>
  execa(
    'zip',
    ['lambda.zip', 'index.js'],
    {
      stdout: process.stdout,
      stderr: process.stderr,
      cwd: 'lambdas/versionUpTest'
    }
  );

describe('When a workflow is running and a new version of a workflow lambda is deployed', () => {
  let beforeAllFailed = false;
  let endAliasVersionNumbers;
  let endVersionNumbers;
  let executionArn;
  let lambdaName;
  let startAliasVersionNumbers;
  let startVersionNumbers;

  const lambdaFile = './lambdas/versionUpTest/index.js';

  beforeAll(async () => {
    try {
      const config = await loadConfig();

      await protectFile(lambdaFile, async () => {
        await fs.writeFile(
          lambdaFile,
          "exports.handler = async () => 'Correct Version';\n"
        );
        await buildZip();
        await terraformApply();
      });

      lambdaName = `${config.stackName}-VersionUpTest`;

      const [
        startVersions,
        startAliases
      ] = await Promise.all([
        getLambdaVersions(lambdaName),
        getLambdaAliases(lambdaName)
      ]);

      startVersionNumbers = startVersions
        .map((x) => x.Version)
        .filter((x) => x !== '$LATEST');

      startAliasVersionNumbers = startAliases.map((x) => x.FunctionVersion);

      executionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'TestLambdaVersionWorkflow'
      );

      await protectFile(lambdaFile, async () => {
        await fs.writeFile(
          lambdaFile,
          "exports.handler = async () => 'Wrong Version';\n"
        );
        await buildZip();
        await terraformApply();
      });

      const workflowStatus = await waitForCompletedExecution(executionArn);
      if (workflowStatus !== 'SUCCEEDED') throw new Error(`Workflow failed: ${executionArn}`);

      const [
        endVersions,
        endAliases
      ] = await Promise.all([
        getLambdaVersions(lambdaName),
        getLambdaAliases(lambdaName)
      ]);

      endVersionNumbers = endVersions
        .map((x) => x.Version)
        .filter((x) => x !== '$LATEST');

      endAliasVersionNumbers = endAliases.map((x) => x.FunctionVersion);
    } catch (err) {
      beforeAllFailed = true;
      console.log('Exception in beforeAll():', err);
      throw err;
    }
  });

  afterAll(() => terraformApply(false));

  it('uses the original software version', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const executionHistory = await getExecutionHistory({ executionArn });

      const successEvent = executionHistory.events.find(
        (event) => event.type === 'LambdaFunctionSucceeded'
      );

      if (successEvent) {
        expect(successEvent.lambdaFunctionSucceededEventDetails.output).toEqual('"Correct Version"');
      } else {
        fail('No LambdaFunctionSucceeded event found');
      }
    }
  });

  it('creates a new Lambda Version', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(Math.max(...endVersionNumbers) - Math.max(...startVersionNumbers)).toEqual(1);
    }
  });

  it('creates an updated Alias', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(Math.max(...endAliasVersionNumbers) - Math.max(...startAliasVersionNumbers)).toEqual(1);
    }
  });

  it('creates aliases for all deployed versions', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(endAliasVersionNumbers.sort()).toEqual(endVersionNumbers.sort());
    }
  });
});
