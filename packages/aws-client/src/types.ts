import * as AWS from 'aws-sdk';

import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';

export type AWSClientTypes = ApiGatewayV2Client | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | S3 | AWS.Service | AWS.DynamoDB.DocumentClient;
