/* eslint no-console: "off" */

'use strict';

const {
  concurrency
} = require('@cumulus/common');
const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const yamlfiles = require('yaml-files');

const STACK_EXPIRATION_MS = 120 * 1000;

const workflowConfigFile = './app/config.yml';

async function getStackName(deployment) {
  const config = yaml.safeLoad(await fs.readFile(workflowConfigFile, 'utf8'), { schema: yamlfiles.YAML_FILES_SCHEMA });

  console.log(config[deployment].stackName);

  return config[deployment].stackName;
}

async function performLock(mutex, stackName, cb) {
  try {
    await mutex.writeLock(stackName, STACK_EXPIRATION_MS);

    return cb(true);
  }
  catch (e) {
    console.log(`Error locking stack ${stackName}: ${e}`);
    return cb(false);
  }
}

async function removeLock(mutex, stackName, cb) {
  try {
    await mutex.unlock(stackName);

    return cb(true);
  }
  catch (e) {
    console.log(`Error unlocking stack ${stackName}: ${e}`);
    return cb(false);
  }
}

async function updateLock(lockFile, deployment, cb) {
  console.log(`deployment: ${deployment}`);

  const stackName = await getStackName(deployment);

  console.log(`stack name: ${stackName}`);

  console.log(`lock: ${lockFile}`);

  const dynamodbDocClient = aws.dynamodbDocClient({
    convertEmptyValues: true
  });

  const mutex = new concurrency.Mutex(dynamodbDocClient, 'lf-test');

  if (lockFile === 'true') {
    return performLock(mutex, stackName, cb);
  }

  return removeLock(mutex, stackName, cb);
}

updateLock(process.argv[2], process.argv[3], console.log);
