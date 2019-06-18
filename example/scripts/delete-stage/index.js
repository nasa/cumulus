#! /usr/bin/env node

'use strict';

/**
 * one time script to remove deployed stage in order to upgrade beyond cumulus
 *  v1.13.
 *  to use just run `node index --stage dev --prefix <prefix>`
 */
const program = require('commander');
const AWS = require('aws-sdk');
const apigateway = new AWS.APIGateway();

program.option('--prefix <name>', 'stack prefix to remove the stages from');
program.option(
  '--stage <name>',
  'name of stage to delete from your apiGateway',
  'dev'
);

program.option(
  '--doit',
  'execute the commands to delete the stage from your prefixed stacks.',
  false
);

program.parse(process.argv);

const filterResponse = (response) => {
  return response.items.filter(thisPrefix);
};

const thisPrefix = (obj) => {
  return obj.name.startsWith(`${program.prefix}-`);
};

const trace = (str) => (obj) => {
  console.log(str);
  console.log(JSON.stringify(obj, 2, null));
  return obj;
};

const removeStage = (restApi) => {
  const param = {
    restApiId: restApi.id,
    stageName: program.stage
  };

  if (program.doit) {
    console.log(
      `DELETING stage: ${param.stageName} from ${restApi.name}(${
        param.restApiId
      }).`
    );

    return apigateway.deleteStage(param).promise();
  }
  console.log(
    `will delete stage: ${param.stageName} from ${restApi.name}(${
      param.restApiId
    }).`
  );
  return Promise.resolve();
};

const removeEachStage = async (restApiList) => {
  await Promise.all(restApiList.map(removeStage));
};

apigateway
  .getRestApis({ limit: 500 })
  .promise()
  .then(filterResponse)
  .then(removeEachStage);
