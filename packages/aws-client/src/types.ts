import * as AWS from 'aws-sdk';

import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';

export type AWSClientTypes = DynamoDB
| DynamoDBClient | AWS.Service | AWS.DynamoDB.DocumentClient;
