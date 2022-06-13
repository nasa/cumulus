import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';

export type AWSClientTypes = APIGatewayClient | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | S3 | AWS.Service | AWS.DynamoDB.DocumentClient;
