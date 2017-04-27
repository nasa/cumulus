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
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const sfn = new AWS.StepFunctions({ apiVersion: '2016-11-23' });

const removeTempDir = () => {
  execSync('rm -rf ./tmp');
};

const usageError = (message) => {
  const cmd = 'node ecs-lambda-runner';
  console.error(`Error: ${message}`);
  console.error(`Usage: ${cmd} functionName --eventJson eventJson --contextJson contextJson`);
  console.error(`   or: ${cmd} functionName --queue queueArn --prefix prefix --bucket bucket`);
  console.error(`   or: ${cmd} functionName --activity activityArn`);
  process.exit(1);
};

const parseAndValidateArgs = (argv) => {
  // First two parameters are 'node' and the script name
  const args = (argv || []).slice(2);

  const validKeys = [
    '--eventJson', '--contextJson',
    '--queue', '--prefix', '--bucket',
    '--activity'
  ];

  const result = { fn: args.shift() };
  for (let i = 0; i < args.length; i += 2) {
    const arg = args[i];
    const key = arg.replace(/Json$/, '');
    const value = arg.match(/Json$/) ? JSON.parse(args[i + 1]) : args[i + 1];
    if (validKeys.indexOf(arg) === -1) usageError(`Unknown parameter ${arg}`);
    if (typeof value === 'undefined')  usageError(`Missing value for parameter ${arg}`);
    result[key.substring(2)] = value;
  }

  if (!result.fn)                      usageError('function argument required');
  if (result.queue && !result.prefix)  usageError('--prefix required');
  if (result.queue && !result.prefix)  usageError('--bucket required');
  if (!result.event && !result.queue && !result.activity) {
    usageError('--eventJson, --queue, or --activity required');
  }
  return result;
};

const extractLambdaHandler = (lambdaFn, callback) => {
  const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });
  removeTempDir();
  fs.mkdirSync("./tmp");

  lambda.getFunction({ FunctionName: lambdaFn }, (err, data) => {
    if (err) {
      console.error(err);
      process.exit(1);
      return;
    }
    const codeUrl = data.Code.Location;
    const handlerId = data.Configuration.Handler;

    const file = fs.createWriteStream("./tmp/fn.zip");
    file.on('finish', () => file.close());
    file.on('close', () => {
      execSync('unzip ./tmp/fn.zip -d ./tmp');
      const moduleFn = handlerId.split('.');
      const module = require(`./tmp/${moduleFn[0]}`); //eslint-disable-line global-require
      callback(module[moduleFn[1]]);
    });
    https.get(codeUrl, (res) => res.pipe(file));
  });
};

const startService = (url, prefix, bucket, handler) => {
  const eventName = url.split(`${prefix}-`).pop().replace(/-events$/, '');
  console.log(`Polling for ${eventName} events...`);
  sqs.receiveMessage({
    QueueUrl: url,
    AttributeNames: ['All']
  }).promise()
     .then((data) => {
       if (data && data.Messages && data.Messages.length > 0) {
         if (data.Messages.length > 1) {
           console.error('Too many messages received');
         }
         const message = data.Messages[0];
         const receipt = message.ReceiptHandle;
         const event = Object.assign(
           { prefix: prefix, bucket: bucket },
           JSON.parse(message.Body),
           { eventQueueItem: { QueueUrl: url, ReceiptHandle: receipt } }
         );
         return handler(event, { via: 'ECS' });
       }
       return null;
     })
     .catch((error) => console.error(error, error.stack))
     .then(() => startService(url, prefix, bucket, handler));
};

const succeedActivity = (result, token) => {
  console.log('Success!', result);
  return sfn.sendTaskSuccess({
    output: JSON.stringify(result),
    taskToken: token
  }).promise();
};

const failActivity = (error, token) => {
  console.log('Fail!', error, error.stack);
  return sfn.sendTaskFailure({
    error: error.message,
    cause: error.stack,
    taskToken: token
  }).promise();
};

const startActivityMonitor = (id, activity, handler) => {
  console.log(`[${new Date().toISOString()}] Polling for ${activity} activities...`);
  let token = null;
  sfn.getActivityTask({
    activityArn: activity,
    workerName: `${id}`
  })
     .promise()
     .then((data) => {
       if (data && data.taskToken) {
         token = data.taskToken;
         console.log(`Invoking task ${token}`);
         return new Promise((resolve, reject) => {
           handler(JSON.parse(data.input), { via: 'ECS' }, (error, data) => {
             if (error) reject(error);
             else resolve(data);
           });
         })
           .then((result) => succeedActivity(result, token));
       }
       return null;
     })
     .catch((error) => failActivity(error, token))
     .catch((error) => console.log(error, error.stack))
     .then(() => setTimeout(() => startActivityMonitor(id, activity, handler), 10000));
};

const main = (args) => {
  extractLambdaHandler(args.fn, (handler) => {
    if (args.queue) {
      startService(args.queue, args.prefix, args.bucket, handler);
    }
    else if (args.activity) {
      const id = Math.floor(Math.random() * 1000000000);
      startActivityMonitor(id, args.activity, handler);
    }
    else {
      const context = Object.assign({},
                                    args.context || { invokedFunctionArn: args.fn },
                                    { via: 'ECS' });
      handler(args.event, context);
    }
  });
};

process.on('exit', removeTempDir);
main(parseAndValidateArgs(process.argv));
