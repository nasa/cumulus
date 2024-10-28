import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EC2 } from '@aws-sdk/client-ec2';
import { ECS } from '@aws-sdk/client-ecs';
import { ElasticsearchService } from '@aws-sdk/client-elasticsearch-service';
import { Kinesis } from '@aws-sdk/client-kinesis';
import { KMS } from '@aws-sdk/client-kms';
import { Lambda } from '@aws-sdk/client-lambda';
import { S3 } from '@aws-sdk/client-s3';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { SFN } from '@aws-sdk/client-sfn';
import { SNS } from '@aws-sdk/client-sns';
import { SQS } from '@aws-sdk/client-sqs';
import { STS } from '@aws-sdk/client-sts';

export type AWSClientTypes =
    APIGatewayClient |
    DynamoDB |
    DynamoDBClient |
    DynamoDBStreamsClient |
    Lambda |
    ECS |
    EC2 |
    ElasticsearchService |
    S3 |
    SecretsManager |
    SFN |
    SNS |
    SQS |
    STS |
    CloudWatchEvents |
    CloudFormation |
    Kinesis |
    KMS;
