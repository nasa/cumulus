'use strict';

const fs = require('fs-extra');

const {
  loadConfig,
  runKes
} = require('../../helpers/testUtils');

const { loadYmlFile } = require('../../helpers/configUtils');

xdescribe('When an iam override template is in the IAM directory ', () => {
  let config;
  let cloudFormation;
  beforeAll(async () => {
    config = loadConfig('iam');
    // Compile with override file in test directory
    try {
      await fs.mkdir('test_iam_override');
      await fs.copy('spec/standalone/redeployment/iam_override_template.yml', 'test_iam_override/cloudformation.template.yml');
      let fileList = await fs.readdir('iam');
      fileList = fileList.filter((x) => x !== 'build');
      const promiseList = fileList.map((filename) => fs.copy(`iam/${filename}`, `test_iam_override/${filename}`));
      await Promise.all(promiseList);
      await runKes(config, {
        kesCommand: 'compile',
        kesClass: 'node_modules/@cumulus/deployment/iam/kes.js',
        kesFolder: 'test_iam_override',
        template: 'node_modules/@cumulus/deployment/iam'
      });
      cloudFormation = loadYmlFile('test_iam_override/cloudformation.yml');
    } finally {
      await fs.remove('test_iam_override');
    }
  });
  it('added a parameter', () => {
    expect(cloudFormation.Description).toEqual('Overridden IAM Stack Description');
  });
});


describe('When an application override template is in the application directory', () => {
  let config;
  let cloudFormation;
  beforeAll(async () => {
    config = loadConfig();
    // Compile with override file in test directory
    try {
      await fs.mkdir('test_app_override');
      await fs.copy('spec/standalone/redeployment/override_template.yml', 'test_app_override/cloudformation.template.yml');
      let fileList = await fs.readdir('app');
      fileList = fileList.filter((x) => x !== 'build');
      const promiseList = fileList.map((filename) => fs.copy(`app/${filename}`, `test_app_override/${filename}`));
      await Promise.all(promiseList);
      await runKes(config, {
        kesCommand: 'compile',
        kesClass: 'node_modules/@cumulus/deployment/app/kes.js',
        kesFolder: 'test_app_override'
      });
      cloudFormation = loadYmlFile('test_app_override/cloudformation.yml');
    } finally {
      await fs.remove('test_app_override');
    }
  });
  it('has overridden the stack description', () => {
    expect(cloudFormation.Description).toEqual('Overridden Stack Description');
  });
});
