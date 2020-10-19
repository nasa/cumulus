---
id: version-v3.0.0-monitoring-readme
title: Monitoring Best Practices
hide_title: false
original_id: monitoring-readme
---

This document intends to provide a set of recommendations and best practices for monitoring the state of a deployed Cumulus and diagnosing any issues.

## Cumulus-provided resources and integrations for monitoring

Cumulus provides a number set of resources that are useful for monitoring the system and its operation.

### Cumulus Dashboard

The primary tool for monitoring the Cumulus system is the Cumulus Dashboard. The dashboard is hosted [on Github](https://github.com/nasa/cumulus-dashboard/) and includes instructions on how to deploy and link it into your core Cumulus deployment.

The dashboard displays workflow executions, their status, inputs, outputs, and some diagnostic information such as logs. For further information on the dashboard, its usage, and the information it provides, see the [documentation](https://github.com/nasa/cumulus-dashboard/blob/master/README.md).

### Cumulus-provided AWS resources

Cumulus sets up CloudWatch log groups for all Core-provided tasks.

#### Monitoring Lambda Functions

Logging for each Lambda Function is available in Lambda-specific CloudWatch log groups.

#### Monitoring ECS services

Each deployed `cumulus_ecs_service` module also includes a CloudWatch log group for the processes running on ECS.

#### Monitoring workflows

For advanced debugging, we also configure dead letter queues on critical system functions. These will allow you to monitor and debug invalid inputs to the functions we use to start workflows, which can be helpful if you find that you are not seeing workflows being started as expected. More information on these can be found in the [dead letter queue documentation](features/lambda_dead_letter_queue.md)

## AWS recommendations

AWS has a number of recommendations on system monitoring. Rather than reproduce those here and risk providing outdated guidance, we've documented the following links which will take you to available AWS docs on monitoring recommendations and best practices for the services used in Cumulus:

- [EC2 Monitoring](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring_ec2.html)
- [Lambda Monitoring](https://docs.aws.amazon.com/lambda/latest/dg/lambda-monitoring.html)
- [CloudWatch documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/index.html)

## Example: Setting up email notifications for CloudWatch logs

Cumulus does not provide out-of-the-box support for email notifications at this time.
However, setting up email notifications on AWS is fairly straightforward in that the operative components are an [AWS SNS topic and a subscribed email address](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/US_SetupSNS.html).

In terms of Cumulus integration, forwarding CloudWatch logs requires creating a mechanism, most likely a [Lambda Function subscribed to the log group](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html#LambdaFunctionExample) that will receive, filter and forward these messages to the SNS topic.

As a very simple example, we could create a function that filters CloudWatch logs created by the `@cumulus/logger` package and sends email notifications for `error` and `fatal` log levels, adapting the example linked above:

```js
const zlib = require('zlib');
const aws = require('aws-sdk');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);
const sns = new aws.SNS();

exports.handler = async (event) => {
  const payload = Buffer.from(event.awslogs.data, 'base64');
  const decompressedData = await gunzip(payload);
  const logData = JSON.parse(decompressedData.toString('ascii'));
  return Promise.all(logData.logEvents.map(async (logEvent) => {
    const logMessage = JSON.parse(logEvent.message);
    if (['error', 'fatal'].includes(logMessage.level)) {
      return sns.publish({
        TopicArn: process.env.EmailReportingTopicArn,
        Message: logEvent.message
      }).promise();
    }
    return Promise.resolve();
  }));
};
```

After creating the SNS topic, We can deploy this code as a lambda function, [following the setup steps from Amazon](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html#LambdaFunctionExample). Make sure to include your SNS topic ARN as an environment variable on the lambda function by using the `--environment` option on `aws lambda create-function`.

You will need to create subscription filters for each log group you want to receive emails for. We recommend automating this as much as possible, and you could very well handle this via Terraform, such as using a module to deploy filters alongside log groups, or exporting the log group names to an all-in-one email notification module.
