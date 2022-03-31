import * as AWS from 'aws-sdk';

import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';

export type AWSClientTypes = ApiGatewayV2Client | DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | AWS.Service | AWS.DynamoDB.DocumentClient;
