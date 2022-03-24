import * as AWS from 'aws-sdk';

import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';

export type AWSClientTypes = DynamoDB
| DynamoDBClient | DynamoDBStreamsClient | AWS.Service | AWS.DynamoDB.DocumentClient;
