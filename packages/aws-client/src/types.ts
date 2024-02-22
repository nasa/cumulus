import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ECS } from '@aws-sdk/client-ecs';
import { Kinesis } from '@aws-sdk/client-kinesis';
import { KMS } from '@aws-sdk/client-kms';
import { Lambda } from '@aws-sdk/client-lambda';
import { S3 } from '@aws-sdk/client-s3';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { SFN } from '@aws-sdk/client-sfn';
import { SNS } from '@aws-sdk/client-sns';
import { SQS } from '@aws-sdk/client-sqs';

export type AWSClientTypes =
    APIGatewayClient |
    DynamoDB |
    DynamoDBClient |
    DynamoDBStreamsClient |
    Lambda |
    ECS |
    S3 |
    SecretsManager |
    SFN |
    SNS |
    SQS |
    CloudWatchEvents |
    CloudFormation |
    Kinesis |
    KMS |
    AWS.Service |
    AWS.DynamoDB.DocumentClient;
