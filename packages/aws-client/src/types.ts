import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';
import { KMSClient } from '@aws-sdk/client-kms';
import { Lambda } from '@aws-sdk/client-lambda';

export type AWSClientTypes = APIGatewayClient | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | S3 | KMSClient |
Lambda | AWS.Service | AWS.DynamoDB.DocumentClient;
