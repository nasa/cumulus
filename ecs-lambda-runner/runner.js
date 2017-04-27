"use strict";
/* eslint-disable no-console */
const https = require('https');
const AWS = require('aws-sdk');
const fs = require('fs');

const execSync = require('child_process').execSync;

const region = process.env.AWS_DEFAULT_REGION || 'us-west-2';
if (region) {
  AWS.config.update({ region: region });
}

const main = (argv) => {
  if (!argv || (argv.length !== 4 && argv.length !== 6)) {
    // First two parameters are 'node' and the script name
    console.error("Run with 1 parameter <eventJson> <contextJson>", argv);
    process.exit(1);
  }

  const event = JSON.parse(argv[2]);
  const context = JSON.parse(argv[3]);

  context.via = 'ECS';

  const lambdaFn = context.invokedFunctionArn || context.functionName;

  const lambdaOpts = { apiVersion: '2015-03-31' };
  if (argv.length === 6) {
    lambdaOpts.accessKeyId = argv[4];
    lambdaOpts.secretAccessKey = argv[5];
  }
  const lambda = new AWS.Lambda(lambdaOpts);
  fs.mkdirSync("./tmp");

  lambda.getFunction({ FunctionName: lambdaFn }, (err, data) => {
    if (err) {
      console.error(err);
      process.exit(1);
      return;
    }
    const codeUrl = data.Code.Location;
    const handler = data.Configuration.Handler;

    const file = fs.createWriteStream("./tmp/fn.zip");
    file.on('finish', () => file.close());
    file.on('close', () => {
      execSync('unzip ./tmp/fn.zip -d ./tmp');
      const moduleFn = handler.split('.');
      const module = require(`./tmp/${moduleFn[0]}`); //eslint-disable-line global-require
      module[moduleFn[1]](event, context, (err, data) => {
        if (err) {
          console.log(err);
          process.exit(2);
        }
        else {
          console.log(data);
          process.exit();
        }
      });
    });
    https.get(codeUrl, (res) => res.pipe(file));
  });
};

process.on('exit', () => execSync('rm -rf ./tmp'));
main(process.argv);
