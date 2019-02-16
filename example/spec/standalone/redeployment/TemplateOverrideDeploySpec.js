'use strict';

const fs = require('fs-extra');
const { aws: { cf } } = require('@cumulus/common');

const {
  loadConfig,
  redeploy
} = require('../../helpers/testUtils');
const config = loadConfig();

describe('When an override template is in the application directory', () => {
  let stackDescription;
  beforeAll(async () => {
    await redeploy(config);
    // Redeploy with override file in test directory
    try {
      await fs.mkdir('test_app_override');
      await fs.copy('spec/standalone/redeployment/override_template.yml', 'test_app_override/cloudformation.template.yml');
      let fileList = await fs.readdir('app');
      fileList = fileList.filter((x) => x !== 'build');
      const promiseList = fileList.map((filename) => fs.copy(`app/${filename}`, `test_app_override/${filename}`));
      await Promise.all(promiseList);
      await redeploy(config, {
        kesClass: 'node_modules/@cumulus/deployment/app/kes.js',
        kesFolder: 'test_app_override'
      });
      stackDescription = await cf().describeStacks({ StackName: config.stackName }).promise();
    }
    finally {
      await fs.remove('test_app_override');
    }
  });
  afterAll(() => redeploy(config));

  it('has overridden the stack description', () => {
    expect(stackDescription.Stacks[0].Description).toEqual('Overridden Stack Description');
  });
});
