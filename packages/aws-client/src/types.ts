import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';
import { Lambda } from '@aws-sdk/client-lambda';

export type AWSClientTypes = APIGatewayClient | CloudWatchEvents | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | S3 | Lambda | AWS.Service | AWS.DynamoDB.DocumentClient;
