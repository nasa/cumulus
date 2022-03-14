import * as AWS from 'aws-sdk';

import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3 } from '@aws-sdk/client-s3';

export type AWSClientTypes = S3 | DynamoDB
| DynamoDBClient | AWS.Service | AWS.DynamoDB.DocumentClient;
