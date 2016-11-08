'use strict';

const async = require('async');
const log = require('./log');
const aws = require('./aws');

exports.ECS = (event, context, lambdaCallback) => {
  const ecs = aws.ecs();

  async.parallel({
    task: (callback) =>
      aws.findResourceArn(ecs,
                          'listTaskDefinitions',
                          event.prefix,
                          'LambdaRunnerTask',
                          { status: 'ACTIVE' },
                          callback),
    cluster: (callback) =>
      aws.findResourceArn(ecs,
                          'listClusters',
                          event.prefix,
                          'IngestECSCluster',
                          {},
                          callback)
  }, (err, resources) => {
    if (err) {
      log.error(err, resources);
      lambdaCallback(err, { isRun: false, isDelegated: false, result: resources });
    }
    else {
      log.info('Delegating to ECS');
      const params = {
        taskDefinition: resources.task,
        cluster: resources.cluster,
        overrides: {
          containerOverrides: [
            {
              name: 'ecs-lambda-runner',
              command: [
                context.invokedFunctionArn || context.functionName,
                '--eventJson',
                JSON.stringify(event),
                '--contextJson',
                JSON.stringify(context)
              ]
            }
          ]
        },
        startedBy: context.awsRequestId,
        count: 1
      };
      ecs.runTask(params, (callbackError, data) => {
        let error = callbackError;
        if (!error && data.failures && data.failures.length > 0) {
          error = JSON.stringify(data.failures);
        }
        if (error) {
          log.error('Error while starting delegate: ', error);
        }
        else {
          const taskInfo = JSON.stringify(data.tasks);
          log.info(`Delegate ${context.functionName} started: ${taskInfo}`);
        }
        lambdaCallback(error, { isRun: false, isDelegated: !error, result: resources });
      });
    }
  });
};
