import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { Kinesis } from '@aws-sdk/client-kinesis';
import { KMS } from '@aws-sdk/client-kms';
import { Lambda } from '@aws-sdk/client-lambda';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { S3 } from '@aws-sdk/client-s3';
import { SQS } from '@aws-sdk/client-sqs';
import { DynamoDBDocument, TranslateConfig } from '@aws-sdk/lib-dynamodb';
import { SNS } from '@aws-sdk/client-sns';
import { ECS } from '@aws-sdk/client-ecs';
import * as AWS from 'aws-sdk';

import awsClient from './client';

export const apigateway = awsClient(APIGatewayClient, '2015-07-09');
export const ecs = awsClient(ecs, '2014-11-13');
export const ec2 = awsClient(AWS.EC2, '2016-11-15');
export const s3 = awsClient(S3, '2006-03-01');
export const kinesis = awsClient(Kinesis, '2013-12-02');
export const lambda = awsClient(Lambda, '2015-03-31');
export const cloudwatchevents = awsClient(CloudWatchEvents, '2015-10-07');
export const sqs = awsClient(SQS, '2012-11-05');
export const cloudwatchlogs = awsClient(AWS.CloudWatchLogs, '2014-03-28');
export const cloudwatch = awsClient(AWS.CloudWatch, '2010-08-01');
export const dynamodb = awsClient(DynamoDB, '2012-08-10');
export const dynamodbstreams = awsClient(DynamoDBStreamsClient, '2012-08-10');
export const dynamodbDocClient = (docClientOptions?: TranslateConfig, dynamoOptions?: object) =>
  DynamoDBDocument.from(
    awsClient(DynamoDB, '2012-08-10')(dynamoOptions),
    docClientOptions
  );
export const sfn = awsClient(AWS.StepFunctions, '2016-11-23');
export const cf = awsClient(CloudFormation, '2010-05-15');
export const sns = awsClient(SNS, '2010-03-31');
export const secretsManager = awsClient(AWS.SecretsManager, '2017-10-17');
export const systemsManager = awsClient(AWS.SSM, '2017-10-17');
export const kms = awsClient(KMS, '2014-11-01');
export const es = awsClient(AWS.ES, '2015-01-01');
export const sts = awsClient(AWS.STS, '2011-06-15');
