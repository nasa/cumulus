const test = require('ava');

const AWS = require('aws-sdk');
const { APIGatewayClient } = require('@aws-sdk/client-api-gateway');
const { CloudWatchEvents } = require('@aws-sdk/client-cloudwatch-events');
const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { Kinesis } = require('@aws-sdk/client-kinesis');
const { Lambda } = require('@aws-sdk/client-lambda');
const { S3 } = require('@aws-sdk/client-s3');
const { SNS } = require('@aws-sdk/client-sns');
const { SQS } = require('@aws-sdk/client-sqs');

const services = require('../services');
const { localStackAwsClientOptions } = require('../test-utils');

test('apigateway() service defaults to localstack in test mode', async (t) => {
  const apigateway = services.apigateway();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(APIGatewayClient);
  t.deepEqual(
    await apigateway.config.credentials(),
    credentials
  );
  const apiGatewayServiceConfig = await apigateway.config.endpoint();
  const endpointConfig = new URL(endpoint);

  t.is(apiGatewayServiceConfig.port, Number(endpointConfig.port));
  t.is(apiGatewayServiceConfig.hostname, endpointConfig.hostname);
  t.is(apiGatewayServiceConfig.protocol, endpointConfig.protocol);
});

test('cf() service defaults to localstack in test mode', async (t) => {
  const cf = services.cf();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(CloudFormation);
  t.deepEqual(
    await cf.config.credentials(),
    credentials
  );

  const cloudFormationEndpoint = await cf.config.endpoint();
  const localstackEndpoint = new URL(endpoint);
  t.like(
    cloudFormationEndpoint,
    {
      hostname: localstackEndpoint.hostname,
      port: Number.parseInt(localstackEndpoint.port, 10),
    }
  );
});

test('cloudwatchevents() service defaults to localstack in test mode', async (t) => {
  const cloudwatchevents = services.cloudwatchevents();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(CloudWatchEvents);

  t.deepEqual(
    await cloudwatchevents.config.credentials(),
    credentials
  );

  const serviceConfigEndpoint = await cloudwatchevents.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('cloudwatchlogs() service defaults to localstack in test mode', (t) => {
  const cloudwatchlogs = services.cloudwatchlogs();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.CloudWatchLogs);
  t.deepEqual(
    cloudwatchlogs.config.credentials,
    credentials
  );
  t.is(cloudwatchlogs.config.endpoint, endpoint);
});

test('cloudwatch() service defaults to localstack in test mode', (t) => {
  const cloudwatch = services.cloudwatch();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.CloudWatch);
  t.deepEqual(
    cloudwatch.config.credentials,
    credentials
  );
  t.is(cloudwatch.config.endpoint, endpoint);
});

test('dynamoDb() service defaults to localstack in test mode', async (t) => {
  const dynamodb = services.dynamodb();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(DynamoDB);
  t.deepEqual(
    await dynamodb.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await dynamodb.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('dynamodbDocClient() service defaults to localstack in test mode', async (t) => {
  const dynamodbDocClient = services.dynamodbDocClient();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(DynamoDB);
  t.deepEqual(
    await dynamodbDocClient.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await dynamodbDocClient.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('dynamodbstreams() service defaults to localstack in test mode', async (t) => {
  const dynamodbstreams = services.dynamodbstreams();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(DynamoDB);
  t.deepEqual(
    await dynamodbstreams.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await dynamodbstreams.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('ecs() service defaults to localstack in test mode', (t) => {
  const ecs = services.ecs();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.ECS);
  t.deepEqual(
    ecs.config.credentials,
    credentials
  );
  t.is(ecs.config.endpoint, endpoint);
});

test('ec2() service defaults to localstack in test mode', (t) => {
  const ec2 = services.ec2();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.EC2);
  t.deepEqual(
    ec2.config.credentials,
    credentials
  );
  t.is(ec2.config.endpoint, endpoint);
});

test('es() service defaults to localstack in test mode', (t) => {
  const es = services.es();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.ES);
  t.deepEqual(
    es.config.credentials,
    credentials
  );
  t.is(es.config.endpoint, endpoint);
});

test('kinesis() service defaults to localstack in test mode', async (t) => {
  const kinesis = services.kinesis();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(Kinesis);
  t.deepEqual(
    await kinesis.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await kinesis.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('kms() service defaults to localstack in test mode', (t) => {
  const kms = services.kms();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.KMS);
  t.deepEqual(
    kms.config.credentials,
    credentials
  );
  t.is(kms.config.endpoint, endpoint);
});

test('lambda() service defaults to localstack in test mode', async (t) => {
  const lambda = services.lambda();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(Lambda);
  t.deepEqual(
    await lambda.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await lambda.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('s3() service defaults to localstack in test mode', async (t) => {
  const s3 = services.s3();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(S3);
  t.deepEqual(
    await s3.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await s3.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('secretsManager() service defaults to localstack in test mode', (t) => {
  const secretsManager = services.secretsManager();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.SecretsManager);
  t.deepEqual(
    secretsManager.config.credentials,
    credentials
  );
  t.is(secretsManager.config.endpoint, endpoint);
});

test('sfn() service defaults to localstack in test mode', (t) => {
  const sfn = services.sfn();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.StepFunctions);
  t.deepEqual(
    sfn.config.credentials,
    credentials
  );
  t.is(sfn.config.endpoint, endpoint);
});

test('sns() service defaults to localstack in test mode', async (t) => {
  const sns = services.sns();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(SNS);
  t.deepEqual(
    await sns.config.credentials(),
    credentials
  );

  const snsEndpoint = await sns.config.endpoint();
  const localstackEndpoint = new URL(endpoint);
  t.like(
    snsEndpoint,
    {
      hostname: localstackEndpoint.hostname,
      port: Number.parseInt(localstackEndpoint.port, 10),
    }
  );
});

test('sqs() service defaults to localstack in test mode', async (t) => {
  const sqs = services.sqs();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(SQS);
  t.deepEqual(
    await sqs.config.credentials(),
    credentials
  );
  const serviceConfigEndpoint = await sqs.config.endpoint();
  const localEndpoint = new URL(endpoint);
  t.like(
    serviceConfigEndpoint,
    {
      hostname: localEndpoint.hostname,
      port: Number.parseInt(localEndpoint.port, 10),
    }
  );
});

test('sts() service defaults to localstack in test mode', (t) => {
  const sts = services.sts();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.STS);
  t.deepEqual(
    sts.config.credentials,
    credentials
  );
  t.is(sts.config.endpoint, endpoint);
});

test('systemsManager() service defaults to localstack in test mode', (t) => {
  const systemsManager = services.systemsManager();
  const {
    credentials,
    endpoint,
  } = localStackAwsClientOptions(AWS.SSM);
  t.deepEqual(
    systemsManager.config.credentials,
    credentials
  );
  t.is(systemsManager.config.endpoint, endpoint);
});
