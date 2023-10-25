import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';
import { SNSClient } from '@aws-sdk/client-sns';

export type AWSClientTypes = APIGatewayClient | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | S3 | SNSClient |
AWS.Service | AWS.DynamoDB.DocumentClient;
