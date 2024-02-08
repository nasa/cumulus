# @cumulus/aws-client

Utilities for working with AWS. These utilities can be used for interacting with live AWS services
or [Localstack][localstack]. For ease of setup, testing, and credential management, code interacting
with AWS services should use the helpers in this module.

⚠️ The [documented API](#api) of this package will not change without a
deprecation warning being provided in earlier releases. Code in this package
that is _not_ documented in this README may change without warning, and is not
considered part of the package's public API.

## Usage

```bash
npm install @cumulus/aws-client
```

## Interacting with Localstack

To use these utilities with [Localstack][localstack], make sure you have a running instance of
Localstack and set this environment variable:

```shell
NODE_ENV=test
```

## API

## Modules

<dl>
<dt><a href="#module_CloudFormation">CloudFormation</a></dt>
<dd></dd>
<dt><a href="#module_CloudwatchEvents">CloudwatchEvents</a></dt>
<dd></dd>
<dt><a href="#module_DynamoDb">DynamoDb</a></dt>
<dd></dd>
<dt><a href="#module_Kinesis">Kinesis</a></dt>
<dd></dd>
<dt><a href="#module_S3">S3</a></dt>
<dd></dd>
<dt><a href="#module_SNS">SNS</a></dt>
<dd></dd>
<dt><a href="#module_SQS">SQS</a></dt>
<dd></dd>
<dt><a href="#module_SecretsManager">SecretsManager</a></dt>
<dd></dd>
<dt><a href="#module_StepFunctions">StepFunctions</a></dt>
<dd></dd>
</dl>

## Classes

<dl>
<dt><a href="#DynamoDbSearchQueue">DynamoDbSearchQueue</a></dt>
<dd><p>Class to efficiently search all of the items in a DynamoDB table, without loading them all into
memory at once.  Handles paging.</p>
</dd>
<dt><a href="#S3ListObjectsV2Queue">S3ListObjectsV2Queue</a></dt>
<dd><p>Class to efficiently list all of the objects in an S3 bucket, without loading
them all into memory at once.  Handles paging of listS3ObjectsV2 requests.</p>
</dd>
<dt><a href="#S3ObjectStore">S3ObjectStore</a></dt>
<dd><p>Class to use when interacting with S3</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#createKey">createKey(params)</a> ⇒ <code>Promise.&lt;Object&gt;</code></dt>
<dd><p>Create a KMS key</p>
<p>See <a href="https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/KMS.html#createKey-property">https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/KMS.html#createKey-property</a>
for allowed params and return value.</p>
</dd>
<dt><a href="#encrypt">encrypt(KeyId, Plaintext)</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Encrypt a string using KMS</p>
</dd>
<dt><a href="#decryptBase64String">decryptBase64String(ciphertext)</a> ⇒ <code>string</code></dt>
<dd><p>Decrypt a KMS-encrypted string, Base 64 encoded</p>
</dd>
</dl>

<a name="module_CloudFormation"></a>

## CloudFormation

* [CloudFormation](#module_CloudFormation)
    * [~describeCfStack(StackName)](#module_CloudFormation..describeCfStack) ⇒ <code>Promise.&lt;CloudFormation.Stack&gt;</code>
    * [~describeCfStackResources(StackName)](#module_CloudFormation..describeCfStackResources) ⇒ <code>Promise.&lt;CloudFormation.StackResources&gt;</code>
    * [~getCfStackParameterValues(stackName, parameterKeys)](#module_CloudFormation..getCfStackParameterValues) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="module_CloudFormation..describeCfStack"></a>

### CloudFormation~describeCfStack(StackName) ⇒ <code>Promise.&lt;CloudFormation.Stack&gt;</code>
Describes a given CloudFormation stack

See [CloudFormation.Stack](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStacks-property)

**Kind**: inner method of [<code>CloudFormation</code>](#module_CloudFormation)  
**Returns**: <code>Promise.&lt;CloudFormation.Stack&gt;</code> - The resources belonging to the stack  

| Param | Type | Description |
| --- | --- | --- |
| StackName | <code>string</code> | The name of the CloudFormation stack to query |

<a name="module_CloudFormation..describeCfStackResources"></a>

### CloudFormation~describeCfStackResources(StackName) ⇒ <code>Promise.&lt;CloudFormation.StackResources&gt;</code>
Describes the resources belonging to a given CloudFormation stack

See [CloudFormation.StackResources](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStackResources-property)

**Kind**: inner method of [<code>CloudFormation</code>](#module_CloudFormation)  
**Returns**: <code>Promise.&lt;CloudFormation.StackResources&gt;</code> - The resources belonging to the stack  

| Param | Type | Description |
| --- | --- | --- |
| StackName | <code>string</code> | The name of the CloudFormation stack to query |

<a name="module_CloudFormation..getCfStackParameterValues"></a>

### CloudFormation~getCfStackParameterValues(stackName, parameterKeys) ⇒ <code>Promise.&lt;Object&gt;</code>
Get parameter values for the given CloudFormation stack

**Kind**: inner method of [<code>CloudFormation</code>](#module_CloudFormation)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Object keyed by parameter names  

| Param | Type | Description |
| --- | --- | --- |
| stackName | <code>string</code> | The name of the CloudFormation stack to query |
| parameterKeys | <code>Array.&lt;string&gt;</code> | Key names for the stack parameters that you want to return |

<a name="module_CloudwatchEvents"></a>

## CloudwatchEvents
<a name="module_CloudwatchEvents..putEvent"></a>

### CloudwatchEvents~putEvent(name, schedule, state, [description], [role]) ⇒ <code>Promise.&lt;CloudWatchEvents.PutRuleResponse&gt;</code>
Create a CloudWatch Events rule

**Kind**: inner method of [<code>CloudwatchEvents</code>](#module_CloudwatchEvents)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the rule name |
| schedule | <code>string</code> | a ScheduleExpression |
| state | <code>string</code> | the state of the rule |
| [description] | <code>string</code> |  |
| [role] | <code>string</code> | a Role ARN |

<a name="module_DynamoDb"></a>

## DynamoDb

* [DynamoDb](#module_DynamoDb)
    * _static_
        * [.scan](#module_DynamoDb.scan) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.createAndWaitForDynamoDbTable(params)](#module_DynamoDb.createAndWaitForDynamoDbTable) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.deleteAndWaitForDynamoDbTableNotExists(params)](#module_DynamoDb.deleteAndWaitForDynamoDbTableNotExists) ⇒ <code>Promise</code>
    * _inner_
        * [~get(params)](#module_DynamoDb..get) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [~parallelScan(params)](#module_DynamoDb..parallelScan) ⇒ <code>Promise</code>

<a name="module_DynamoDb.scan"></a>

### DynamoDb.scan ⇒ <code>Promise.&lt;Object&gt;</code>
Call DynamoDb client scan

See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html)
for descriptions of `params` and the return data.

**Kind**: static property of [<code>DynamoDb</code>](#module_DynamoDb)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="module_DynamoDb.createAndWaitForDynamoDbTable"></a>

### DynamoDb.createAndWaitForDynamoDbTable(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Create a DynamoDB table and then wait for the table to exist

**Kind**: static method of [<code>DynamoDb</code>](#module_DynamoDb)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the output of the createTable call  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | the same params that you would pass to AWS.createTable   See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/dynamodb.html#createtable |

<a name="module_DynamoDb.deleteAndWaitForDynamoDbTableNotExists"></a>

### DynamoDb.deleteAndWaitForDynamoDbTableNotExists(params) ⇒ <code>Promise</code>
Delete a DynamoDB table and then wait for the table to not exist

**Kind**: static method of [<code>DynamoDb</code>](#module_DynamoDb)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | the same params that you would pass to AWS.deleteTable   See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/dynamodb.html#deletetable |

<a name="module_DynamoDb..get"></a>

### DynamoDb~get(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Call DynamoDb client get

See [DocumentClient.get()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html)
for descriptions of `params` and the return data.

**Kind**: inner method of [<code>DynamoDb</code>](#module_DynamoDb)  
**Throws**:

- <code>RecordDoesNotExist</code> if a record cannot be found


| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.tableName | <code>string</code> | Table name to read |
| params.item | <code>GetCommandInput.Key</code> | Key identifying object to get |
| params.client | <code>DynamoDBDocument</code> | Instance of a DynamoDb DocumentClient |
| params.getParams | <code>Object</code> | Additional parameters for DocumentClient.get() |

<a name="module_DynamoDb..parallelScan"></a>

### DynamoDb~parallelScan(params) ⇒ <code>Promise</code>
Do a parallel scan of DynamoDB table using a document client.

See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan.
See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html).

**Kind**: inner method of [<code>DynamoDb</code>](#module_DynamoDb)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.totalSegments | <code>number</code> | Total number of segments to divide table into for parallel scanning |
| params.scanParams | <code>ScanInput</code> | Params for the DynamoDB client scan operation   See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html |
| params.processItemsFunc | <code>function</code> | Function used to process returned items by scan |
| [params.dynamoDbClient] | <code>DynamoDBDocument</code> | Instance of Dynamo DB document client |
| [params.retryOptions] | <code>pRetry.Options</code> | Retry options for scan operations |

<a name="module_Kinesis"></a>

## Kinesis
<a name="module_Kinesis..describeStream"></a>

### Kinesis~describeStream(params, retryOptions) ⇒ <code>Promise.&lt;Object&gt;</code>
Describe a Kinesis stream.

**Kind**: inner method of [<code>Kinesis</code>](#module_Kinesis)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - The stream description response  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.StreamName | <code>string</code> | A Kinesis stream name |
| retryOptions | <code>Object</code> | Options passed to p-retry module |

<a name="module_S3"></a>

## S3

* [S3](#module_S3)
    * _static_
        * ~~[.getS3Object](#module_S3.getS3Object) ⇒ <code>Promise</code>~~
        * [.recursivelyDeleteS3Bucket](#module_S3.recursivelyDeleteS3Bucket) ⇒ <code>Promise</code>
        * [.listS3ObjectsV2(params)](#module_S3.listS3ObjectsV2) ⇒ <code>Promise.&lt;Array&gt;</code>
    * _inner_
        * [~s3Join(...args)](#module_S3..s3Join) ⇒ <code>string</code>
        * [~parseS3Uri(uri)](#module_S3..parseS3Uri) ⇒ <code>Object</code>
        * [~buildS3Uri(bucket, key)](#module_S3..buildS3Uri) ⇒ <code>string</code>
        * [~s3TagSetToQueryString(tagset)](#module_S3..s3TagSetToQueryString) ⇒ <code>string</code>
        * [~deleteS3Object(bucket, key)](#module_S3..deleteS3Object) ⇒ <code>Promise</code>
        * [~headObject(Bucket, Key, retryOptions)](#module_S3..headObject) ⇒ <code>Promise</code>
        * [~s3ObjectExists(params)](#module_S3..s3ObjectExists) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [~waitForObjectToExist(params)](#module_S3..waitForObjectToExist) ⇒ <code>Promise.&lt;undefined&gt;</code>
        * [~s3PutObject(params)](#module_S3..s3PutObject) ⇒ <code>Promise</code>
        * [~putFile(bucket, key, filename)](#module_S3..putFile) ⇒ <code>Promise</code>
        * [~s3CopyObject(params)](#module_S3..s3CopyObject) ⇒ <code>Promise</code>
        * [~promiseS3Upload(params)](#module_S3..promiseS3Upload) ⇒ <code>Promise</code>
        * [~streamS3Upload(uploadStream, uploadParams)](#module_S3..streamS3Upload) ⇒ <code>Promise</code>
        * [~getObjectReadStream(params)](#module_S3..getObjectReadStream) ⇒ <code>Promise.&lt;Readable&gt;</code>
        * [~downloadS3File(s3Obj, filepath)](#module_S3..downloadS3File) ⇒ <code>Promise.&lt;string&gt;</code>
        * [~getObjectSize(params)](#module_S3..getObjectSize) ⇒ <code>Promise.&lt;(number\|undefined)&gt;</code>
        * [~s3GetObjectTagging(bucket, key)](#module_S3..s3GetObjectTagging) ⇒ <code>Promise.&lt;GetObjectTaggingOutput&gt;</code>
        * [~s3PutObjectTagging(Bucket, Key, ObjectTagging)](#module_S3..s3PutObjectTagging) ⇒ <code>Promise</code>
        * [~getObject(s3Client, params)](#module_S3..getObject) ⇒ <code>Promise.&lt;GetObjectOutput&gt;</code>
        * [~waitForObject(s3Client, params, [retryOptions])](#module_S3..waitForObject) ⇒ <code>Promise.&lt;GetObjectOutput&gt;</code>
        * [~getObjectStreamContents(objectReadStream)](#module_S3..getObjectStreamContents) ⇒ <code>Promise.&lt;string&gt;</code>
        * [~getTextObject(bucket, key)](#module_S3..getTextObject) ⇒ <code>Promise.&lt;string&gt;</code>
        * [~getJsonS3Object(bucket, key)](#module_S3..getJsonS3Object) ⇒ <code>Promise.&lt;\*&gt;</code>
        * [~fileExists(bucket, key)](#module_S3..fileExists) ⇒ <code>Promise</code>
        * [~deleteS3Files(s3Objs)](#module_S3..deleteS3Files) ⇒ <code>Promise</code>
        * [~deleteS3Buckets(buckets)](#module_S3..deleteS3Buckets) ⇒ <code>Promise</code>
        * [~uploadS3FileStream(fileStream, bucket, key, s3opts)](#module_S3..uploadS3FileStream) ⇒ <code>Promise</code>
        * [~listS3Objects(bucket, prefix, skipFolders)](#module_S3..listS3Objects) ⇒ <code>Promise</code>
        * [~calculateObjectHash(params)](#module_S3..calculateObjectHash)
        * [~validateS3ObjectChecksum(params)](#module_S3..validateS3ObjectChecksum) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [~getFileBucketAndKey(pathParams)](#module_S3..getFileBucketAndKey) ⇒ <code>Array.&lt;string&gt;</code>
        * [~createBucket(Bucket)](#module_S3..createBucket) ⇒ <code>Promise</code>
        * [~createS3Buckets(buckets)](#module_S3..createS3Buckets) ⇒ <code>Promise</code>
        * [~multipartCopyObject(params)](#module_S3..multipartCopyObject) ⇒ <code>Promise.&lt;{etag: string}&gt;</code>
        * [~moveObject(params)](#module_S3..moveObject) ⇒ <code>Promise.&lt;undefined&gt;</code>

<a name="module_S3.getS3Object"></a>

### ~~S3.getS3Object ⇒ <code>Promise</code>~~
***Deprecated***

Gets an object from S3.

**Kind**: static property of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - returns response from `S3.getObject` as a promise  

| Param | Type | Description |
| --- | --- | --- |
| Bucket | <code>string</code> | name of bucket |
| Key | <code>string</code> | key for object (filepath + filename) |
| retryOptions | <code>Object</code> | options to control retry behavior when an   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions   By default, retries will not be performed |

<a name="module_S3.recursivelyDeleteS3Bucket"></a>

### S3.recursivelyDeleteS3Bucket ⇒ <code>Promise</code>
Delete a bucket and all of its objects from S3

**Kind**: static property of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - the promised result of `S3.deleteBucket`  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | name of the bucket |

<a name="module_S3.listS3ObjectsV2"></a>

### S3.listS3ObjectsV2(params) ⇒ <code>Promise.&lt;Array&gt;</code>
Fetch complete list of S3 objects

listObjectsV2 is limited to 1,000 results per call.  This function continues
listing objects until there are no more to be fetched.

The passed params must be compatible with the listObjectsV2 call.

https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjectsV2-property

**Kind**: static method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;Array&gt;</code> - resolves to an array of objects corresponding to
  the Contents property of the listObjectsV2 response  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | params for the s3.listObjectsV2 call |

<a name="module_S3..s3Join"></a>

### S3~s3Join(...args) ⇒ <code>string</code>
Join strings into an S3 key without a leading slash

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>string</code> - the full S3 key  

| Param | Type | Description |
| --- | --- | --- |
| ...args | <code>string</code> \| <code>Array.&lt;string&gt;</code> | the strings to join |

<a name="module_S3..parseS3Uri"></a>

### S3~parseS3Uri(uri) ⇒ <code>Object</code>
parse an s3 uri to get the bucket and key

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Object</code> - Returns an object with `Bucket` and `Key` properties  

| Param | Type | Description |
| --- | --- | --- |
| uri | <code>string</code> | must be a uri with the `s3://` protocol |

<a name="module_S3..buildS3Uri"></a>

### S3~buildS3Uri(bucket, key) ⇒ <code>string</code>
Given a bucket and key, return an S3 URI

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>string</code> - an S3 URI  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | an S3 bucket name |
| key | <code>string</code> | an S3 key |

<a name="module_S3..s3TagSetToQueryString"></a>

### S3~s3TagSetToQueryString(tagset) ⇒ <code>string</code>
Convert S3 TagSet Object to query string
e.g. [{ Key: 'tag', Value: 'value }] to 'tag=value'

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>string</code> - tags query string  

| Param | Type | Description |
| --- | --- | --- |
| tagset | <code>Array.&lt;Object&gt;</code> | S3 TagSet array |

<a name="module_S3..deleteS3Object"></a>

### S3~deleteS3Object(bucket, key) ⇒ <code>Promise</code>
Delete an object from S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - promise of the object being deleted  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | bucket where the object exists |
| key | <code>string</code> | key of the object to be deleted |

<a name="module_S3..headObject"></a>

### S3~headObject(Bucket, Key, retryOptions) ⇒ <code>Promise</code>
Get an object header from S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - returns response from `S3.headObject` as a promise  

| Param | Type | Description |
| --- | --- | --- |
| Bucket | <code>string</code> | name of bucket |
| Key | <code>string</code> | key for object (filepath + filename) |
| retryOptions | <code>Object</code> | options to control retry behavior when an   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions   By default, retries will not be performed |

<a name="module_S3..s3ObjectExists"></a>

### S3~s3ObjectExists(params) ⇒ <code>Promise.&lt;boolean&gt;</code>
Test if an object exists in S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - a Promise that will resolve to a boolean indicating
                              if the object exists  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property |

<a name="module_S3..waitForObjectToExist"></a>

### S3~waitForObjectToExist(params) ⇒ <code>Promise.&lt;undefined&gt;</code>
Wait for an object to exist in S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.bucket | <code>string</code> |  |  |
| params.key | <code>string</code> |  |  |
| [params.interval] | <code>number</code> | <code>1000</code> | interval before retries, in ms |
| [params.timeout] | <code>number</code> | <code>30000</code> | timeout, in ms |

<a name="module_S3..s3PutObject"></a>

### S3~s3PutObject(params) ⇒ <code>Promise</code>
Put an object on S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property promise of the object being put |

<a name="module_S3..putFile"></a>

### S3~putFile(bucket, key, filename) ⇒ <code>Promise</code>
Upload a file to S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | the destination S3 bucket |
| key | <code>string</code> | the destination S3 key |
| filename | <code>filename</code> | the local file to be uploaded |

<a name="module_S3..s3CopyObject"></a>

### S3~s3CopyObject(params) ⇒ <code>Promise</code>
Copy an object from one location on S3 to another

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - promise of the object being copied  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property |

<a name="module_S3..promiseS3Upload"></a>

### S3~promiseS3Upload(params) ⇒ <code>Promise</code>
Upload data to S3

see https://github.com/aws/aws-sdk-js-v3/tree/main/lib/lib-storage

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type |
| --- | --- |
| params | <code>UploadOptions</code> | 

<a name="module_S3..streamS3Upload"></a>

### S3~streamS3Upload(uploadStream, uploadParams) ⇒ <code>Promise</code>
Upload data to S3 using a stream

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| uploadStream | <code>Readable</code> | Stream of data to upload |
| uploadParams | <code>Object</code> |  |

<a name="module_S3..getObjectReadStream"></a>

### S3~getObjectReadStream(params) ⇒ <code>Promise.&lt;Readable&gt;</code>
Get a readable stream for an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.s3 | <code>S3</code> | an S3 instance |
| params.bucket | <code>string</code> | the bucket of the requested object |
| params.key | <code>string</code> | the key of the requested object |

<a name="module_S3..downloadS3File"></a>

### S3~downloadS3File(s3Obj, filepath) ⇒ <code>Promise.&lt;string&gt;</code>
Downloads the given s3Obj to the given filename in a streaming manner

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;string&gt;</code> - returns filename if successful  

| Param | Type | Description |
| --- | --- | --- |
| s3Obj | <code>Object</code> | The parameters to send to S3 getObject call |
| filepath | <code>string</code> | The filepath of the file that is downloaded |

<a name="module_S3..getObjectSize"></a>

### S3~getObjectSize(params) ⇒ <code>Promise.&lt;(number\|undefined)&gt;</code>
Get the size of an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;(number\|undefined)&gt;</code> - object size, in bytes  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.bucket | <code>string</code> |  |
| params.key | <code>string</code> |  |
| params.s3 | <code>S3</code> | an S3 client instance |

<a name="module_S3..s3GetObjectTagging"></a>

### S3~s3GetObjectTagging(bucket, key) ⇒ <code>Promise.&lt;GetObjectTaggingOutput&gt;</code>
Get object Tagging from S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;GetObjectTaggingOutput&gt;</code> - the promised response from `S3.getObjectTagging`  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | name of bucket |
| key | <code>string</code> | key for object (filepath + filename) |

<a name="module_S3..s3PutObjectTagging"></a>

### S3~s3PutObjectTagging(Bucket, Key, ObjectTagging) ⇒ <code>Promise</code>
Puts object Tagging in S3
https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObjectTagging-property

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - returns response from `S3.getObjectTagging` as a promise  

| Param | Type | Description |
| --- | --- | --- |
| Bucket | <code>string</code> | name of bucket |
| Key | <code>string</code> | key for object (filepath + filename) |
| ObjectTagging | <code>Object</code> | tagging object |

<a name="module_S3..getObject"></a>

### S3~getObject(s3Client, params) ⇒ <code>Promise.&lt;GetObjectOutput&gt;</code>
Gets an object from S3.

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;GetObjectOutput&gt;</code> - response from `S3.getObject()`
  as a Promise  

| Param | Type | Description |
| --- | --- | --- |
| s3Client | <code>S3</code> | an `S3` instance |
| params | <code>GetObjectCommandInput</code> | parameters object to pass through   to `S3.getObject()` |

**Example**  
```js
const obj = await getObject(s3(), { Bucket: 'b', Key: 'k' })
```
<a name="module_S3..waitForObject"></a>

### S3~waitForObject(s3Client, params, [retryOptions]) ⇒ <code>Promise.&lt;GetObjectOutput&gt;</code>
Get an object from S3, waiting for it to exist and, if specified, have the
correct ETag.

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Default |
| --- | --- | --- |
| s3Client | <code>S3</code> |  | 
| params | <code>GetObjectCommandInput</code> |  | 
| [retryOptions] | <code>pRetry.Options</code> | <code>{}</code> | 

<a name="module_S3..getObjectStreamContents"></a>

### S3~getObjectStreamContents(objectReadStream) ⇒ <code>Promise.&lt;string&gt;</code>
Transform streaming response from S3 object to text content

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the contents of the S3 object  

| Param | Type | Description |
| --- | --- | --- |
| objectReadStream | <code>Readable</code> | Readable stream of S3 object |

<a name="module_S3..getTextObject"></a>

### S3~getTextObject(bucket, key) ⇒ <code>Promise.&lt;string&gt;</code>
Fetch the contents of an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the contents of the S3 object  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | the S3 object's bucket |
| key | <code>string</code> | the S3 object's key |

<a name="module_S3..getJsonS3Object"></a>

### S3~getJsonS3Object(bucket, key) ⇒ <code>Promise.&lt;\*&gt;</code>
Fetch JSON stored in an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;\*&gt;</code> - the contents of the S3 object, parsed as JSON  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | the S3 object's bucket |
| key | <code>string</code> | the S3 object's key |

<a name="module_S3..fileExists"></a>

### S3~fileExists(bucket, key) ⇒ <code>Promise</code>
Check if a file exists in an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - returns the response from `S3.headObject` as a promise  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | name of the S3 bucket |
| key | <code>string</code> | key of the file in the S3 bucket |

<a name="module_S3..deleteS3Files"></a>

### S3~deleteS3Files(s3Objs) ⇒ <code>Promise</code>
Delete files from S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - A promise that resolves to an Array of the data returned
  from the deletion operations  

| Param | Type | Description |
| --- | --- | --- |
| s3Objs | <code>Array</code> | An array of objects containing keys 'Bucket' and 'Key' |

<a name="module_S3..deleteS3Buckets"></a>

### S3~deleteS3Buckets(buckets) ⇒ <code>Promise</code>
Delete a list of buckets and all of their objects from S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - the promised result of `S3.deleteBucket`  

| Param | Type | Description |
| --- | --- | --- |
| buckets | <code>Array</code> | list of bucket names |

<a name="module_S3..uploadS3FileStream"></a>

### S3~uploadS3FileStream(fileStream, bucket, key, s3opts) ⇒ <code>Promise</code>
Upload the file associated with the given stream to an S3 bucket

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - A promise  

| Param | Type | Description |
| --- | --- | --- |
| fileStream | <code>ReadableStream</code> | The stream for the file's contents |
| bucket | <code>string</code> | The S3 bucket to which the file is to be uploaded |
| key | <code>string</code> | The key to the file in the bucket |
| s3opts | <code>Object</code> | Options to pass to the AWS sdk call (defaults to `{}`) |

<a name="module_S3..listS3Objects"></a>

### S3~listS3Objects(bucket, prefix, skipFolders) ⇒ <code>Promise</code>
List the objects in an S3 bucket

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise</code> - A promise that resolves to the list of objects. Each S3
  object is represented as a JS object with the following attributes: `Key`,
`ETag`, `LastModified`, `Owner`, `Size`, `StorageClass`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| bucket | <code>string</code> |  | The name of the bucket |
| prefix | <code>string</code> |  | Only objects with keys starting with this prefix   will be included (useful for searching folders in buckets, e.g., '/PDR') |
| skipFolders | <code>boolean</code> | <code>true</code> | If true don't return objects that are folders   (defaults to true) |

<a name="module_S3..calculateObjectHash"></a>

### S3~calculateObjectHash(params)
Calculate the cryptographic hash of an S3 object

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.s3 | <code>S3</code> | an S3 instance |
| params.algorithm | <code>string</code> | `cksum`, or an algorithm listed in   `openssl list -digest-algorithms` |
| params.bucket | <code>string</code> |  |
| params.key | <code>string</code> |  |

<a name="module_S3..validateS3ObjectChecksum"></a>

### S3~validateS3ObjectChecksum(params) ⇒ <code>Promise.&lt;boolean&gt;</code>
Validate S3 object checksum against expected sum

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - returns true for success  
**Throws**:

- <code>InvalidChecksum</code> - Throws error if validation fails


| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | params |
| params.algorithm | <code>string</code> | checksum algorithm |
| params.bucket | <code>string</code> | S3 bucket |
| params.key | <code>string</code> | S3 key |
| params.expectedSum | <code>number</code> \| <code>string</code> | expected checksum |
| [params.options] | <code>Object</code> | crypto.createHash options |

<a name="module_S3..getFileBucketAndKey"></a>

### S3~getFileBucketAndKey(pathParams) ⇒ <code>Array.&lt;string&gt;</code>
Extract the S3 bucket and key from the URL path parameters

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Array.&lt;string&gt;</code> - `[Bucket, Key]`  

| Param | Type | Description |
| --- | --- | --- |
| pathParams | <code>string</code> | path parameters from the URL bucket/key in the form of |

<a name="module_S3..createBucket"></a>

### S3~createBucket(Bucket) ⇒ <code>Promise</code>
Create an S3 bucket

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| Bucket | <code>string</code> | the name of the S3 bucket to create |

<a name="module_S3..createS3Buckets"></a>

### S3~createS3Buckets(buckets) ⇒ <code>Promise</code>
Create multiple S3 buckets

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Description |
| --- | --- | --- |
| buckets | <code>Array.&lt;string&gt;</code> | the names of the S3 buckets to create |

<a name="module_S3..multipartCopyObject"></a>

### S3~multipartCopyObject(params) ⇒ <code>Promise.&lt;{etag: string}&gt;</code>
Copy an S3 object to another location in S3 using a multipart copy

**Kind**: inner method of [<code>S3</code>](#module_S3)  
**Returns**: <code>Promise.&lt;{etag: string}&gt;</code> - object containing the ETag of the
   destination object

note: this method may error if used with zero byte files. see CUMULUS-2557 and https://github.com/nasa/cumulus/pull/2117.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.sourceBucket | <code>string</code> |  |  |
| params.sourceKey | <code>string</code> |  |  |
| params.destinationBucket | <code>string</code> |  |  |
| params.destinationKey | <code>string</code> |  |  |
| [params.sourceObject] | <code>S3.HeadObjectOutput</code> |  | Output from https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property |
| [params.ACL] | <code>string</code> |  | an [S3 Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl) |
| [params.copyTags] | <code>boolean</code> | <code>false</code> |  |
| [params.chunkSize] | <code>number</code> |  | chunk size of the S3 multipart uploads |

<a name="module_S3..moveObject"></a>

### S3~moveObject(params) ⇒ <code>Promise.&lt;undefined&gt;</code>
Move an S3 object to another location in S3

**Kind**: inner method of [<code>S3</code>](#module_S3)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.sourceBucket | <code>string</code> |  |  |
| params.sourceKey | <code>string</code> |  |  |
| params.destinationBucket | <code>string</code> |  |  |
| params.destinationKey | <code>string</code> |  |  |
| [params.ACL] | <code>string</code> |  | an [S3 Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl) |
| [params.copyTags] | <code>boolean</code> | <code>false</code> |  |
| [params.chunkSize] | <code>number</code> |  | chunk size of the S3 multipart uploads |

<a name="module_SNS"></a>

## SNS
<a name="module_SNS..publishSnsMessage"></a>

### SNS~publishSnsMessage(snsTopicArn, message, retryOptions) ⇒ <code>Promise.&lt;undefined&gt;</code>
Publish a message to an SNS topic. Does not catch
errors, to allow more specific handling by the caller.

**Kind**: inner method of [<code>SNS</code>](#module_SNS)  

| Param | Type | Description |
| --- | --- | --- |
| snsTopicArn | <code>string</code> | SNS topic ARN |
| message | <code>Object</code> | Message object |
| retryOptions | <code>Object</code> | options to control retry behavior when publishing a message fails. See https://github.com/tim-kos/node-retry#retryoperationoptions |

<a name="module_SQS"></a>

## SQS

* [SQS](#module_SQS)
    * _static_
        * [.createQueue(QueueName)](#module_SQS.createQueue) ⇒ <code>Promise.&lt;string&gt;</code>
    * _inner_
        * [~sendSQSMessage(queueUrl, message, [logOverride])](#module_SQS..sendSQSMessage) ⇒ <code>Promise</code>
        * [~receiveSQSMessages(queueUrl, options)](#module_SQS..receiveSQSMessages) ⇒ <code>Promise.&lt;Array&gt;</code>
        * [~deleteSQSMessage(queueUrl, receiptHandle)](#module_SQS..deleteSQSMessage) ⇒ <code>Promise</code>
        * [~sqsQueueExists(queueUrl)](#module_SQS..sqsQueueExists) ⇒ <code>Promise.&lt;boolean&gt;</code>

<a name="module_SQS.createQueue"></a>

### SQS.createQueue(QueueName) ⇒ <code>Promise.&lt;string&gt;</code>
Create an SQS Queue.  Properly handles localstack queue URLs

**Kind**: static method of [<code>SQS</code>](#module_SQS)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the Queue URL  

| Param | Type | Description |
| --- | --- | --- |
| QueueName | <code>string</code> | queue name |

<a name="module_SQS..sendSQSMessage"></a>

### SQS~sendSQSMessage(queueUrl, message, [logOverride]) ⇒ <code>Promise</code>
Send a message to AWS SQS

**Kind**: inner method of [<code>SQS</code>](#module_SQS)  
**Returns**: <code>Promise</code> - resolves when the messsage has been sent  

| Param | Type | Description |
| --- | --- | --- |
| queueUrl | <code>string</code> | url of the SQS queue |
| message | <code>string</code> \| <code>Object</code> | either string or object message. If an   object it will be serialized into a JSON string. |
| [logOverride] | <code>Logger</code> | optional Logger passed in for testing |

<a name="module_SQS..receiveSQSMessages"></a>

### SQS~receiveSQSMessages(queueUrl, options) ⇒ <code>Promise.&lt;Array&gt;</code>
Receives SQS messages from a given queue. The number of messages received
can be set and the timeout is also adjustable.

**Kind**: inner method of [<code>SQS</code>](#module_SQS)  
**Returns**: <code>Promise.&lt;Array&gt;</code> - an array of messages  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| queueUrl | <code>string</code> |  | url of the SQS queue |
| options | <code>Object</code> |  | options object |
| [options.numOfMessages] | <code>integer</code> | <code>1</code> | number of messages to read from the queue |
| [options.visibilityTimeout] | <code>integer</code> | <code>30</code> | number of seconds a message is invisible   after read |
| [options.waitTimeSeconds] | <code>integer</code> | <code>0</code> | number of seconds to poll SQS queue (long polling) |

<a name="module_SQS..deleteSQSMessage"></a>

### SQS~deleteSQSMessage(queueUrl, receiptHandle) ⇒ <code>Promise</code>
Delete a given SQS message from a given queue.

**Kind**: inner method of [<code>SQS</code>](#module_SQS)  
**Returns**: <code>Promise</code> - an AWS SQS response  

| Param | Type | Description |
| --- | --- | --- |
| queueUrl | <code>string</code> | url of the SQS queue |
| receiptHandle | <code>integer</code> | the unique identifier of the sQS message |

<a name="module_SQS..sqsQueueExists"></a>

### SQS~sqsQueueExists(queueUrl) ⇒ <code>Promise.&lt;boolean&gt;</code>
Test if an SQS queue exists

**Kind**: inner method of [<code>SQS</code>](#module_SQS)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - - a Promise that will resolve to a boolean indicating
                              if the queue exists  

| Param | Type | Description |
| --- | --- | --- |
| queueUrl | <code>Object</code> | queue url |

<a name="module_SecretsManager"></a>

## SecretsManager
<a name="module_StepFunctions"></a>

## StepFunctions

* [StepFunctions](#module_StepFunctions)
    * _static_
        * [.describeExecution(params)](#module_StepFunctions.describeExecution) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.describeStateMachine(params)](#module_StepFunctions.describeStateMachine) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.getExecutionHistory(params)](#module_StepFunctions.getExecutionHistory) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.listExecutions(params)](#module_StepFunctions.listExecutions) ⇒ <code>Promise.&lt;Object&gt;</code>
    * _inner_
        * [~executionExists(executionArn)](#module_StepFunctions..executionExists) ⇒ <code>Promise.&lt;boolean&gt;</code>

<a name="module_StepFunctions.describeExecution"></a>

### StepFunctions.describeExecution(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Call StepFunctions DescribeExecution

See [StepFunctions.describeExecution()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeExecution-property)
for descriptions of `params` and the return data.

If a ThrottlingException is received, this function will retry using an
exponential backoff.

**Kind**: static method of [<code>StepFunctions</code>](#module_StepFunctions)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="module_StepFunctions.describeStateMachine"></a>

### StepFunctions.describeStateMachine(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Call StepFunctions DescribeStateMachine

See [StepFunctions.describeStateMachine()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeStateMachine-property)
for descriptions of `params` and the return data.

If a ThrottlingException is received, this function will retry using an
exponential backoff.

**Kind**: static method of [<code>StepFunctions</code>](#module_StepFunctions)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="module_StepFunctions.getExecutionHistory"></a>

### StepFunctions.getExecutionHistory(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Call StepFunctions GetExecutionHistory

See [StepFunctions.getExecutionHistory()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#getExecutionHistory-property)
for descriptions of `params` and the return data.

If a ThrottlingException is received, this function will retry using an
exponential backoff.

**Kind**: static method of [<code>StepFunctions</code>](#module_StepFunctions)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="module_StepFunctions.listExecutions"></a>

### StepFunctions.listExecutions(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Call StepFunctions ListExecutions

See [StepFunctions.listExecutions()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#listExecutions-property)
for descriptions of `params` and the return data.

If a ThrottlingException is received, this function will retry using an
exponential backoff.

**Kind**: static method of [<code>StepFunctions</code>](#module_StepFunctions)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="module_StepFunctions..executionExists"></a>

### StepFunctions~executionExists(executionArn) ⇒ <code>Promise.&lt;boolean&gt;</code>
Check if a Step Function Execution exists

If a ThrottlingException is received, this function will retry using an
exponential backoff.

**Kind**: inner method of [<code>StepFunctions</code>](#module_StepFunctions)  

| Param | Type | Description |
| --- | --- | --- |
| executionArn | <code>string</code> | the ARN of the Step Function Execution to   check for |

<a name="DynamoDbSearchQueue"></a>

## DynamoDbSearchQueue
Class to efficiently search all of the items in a DynamoDB table, without loading them all into
memory at once.  Handles paging.

**Kind**: global class  

* [DynamoDbSearchQueue](#DynamoDbSearchQueue)
    * [.empty()](#DynamoDbSearchQueue+empty) ⇒ <code>Promise.&lt;Array&gt;</code>
    * [.peek()](#DynamoDbSearchQueue+peek) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.shift()](#DynamoDbSearchQueue+shift) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="DynamoDbSearchQueue+empty"></a>

### dynamoDbSearchQueue.empty() ⇒ <code>Promise.&lt;Array&gt;</code>
Drain all values from the searchQueue, and return to the user.
Warning: This can be very memory intensive.

**Kind**: instance method of [<code>DynamoDbSearchQueue</code>](#DynamoDbSearchQueue)  
**Returns**: <code>Promise.&lt;Array&gt;</code> - array of search results.  
<a name="DynamoDbSearchQueue+peek"></a>

### dynamoDbSearchQueue.peek() ⇒ <code>Promise.&lt;Object&gt;</code>
View the next item in the queue

This does not remove the object from the queue.  When there are no more
items in the queue, returns 'null'.

**Kind**: instance method of [<code>DynamoDbSearchQueue</code>](#DynamoDbSearchQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an item from the DynamoDB table  
<a name="DynamoDbSearchQueue+shift"></a>

### dynamoDbSearchQueue.shift() ⇒ <code>Promise.&lt;Object&gt;</code>
Remove the next item from the queue

When there are no more items in the queue, returns 'null'.

**Kind**: instance method of [<code>DynamoDbSearchQueue</code>](#DynamoDbSearchQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an item from the DynamoDB table  
<a name="S3ListObjectsV2Queue"></a>

## S3ListObjectsV2Queue
Class to efficiently list all of the objects in an S3 bucket, without loading
them all into memory at once.  Handles paging of listS3ObjectsV2 requests.

**Kind**: global class  

* [S3ListObjectsV2Queue](#S3ListObjectsV2Queue)
    * [.peek()](#S3ListObjectsV2Queue+peek) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.shift()](#S3ListObjectsV2Queue+shift) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="S3ListObjectsV2Queue+peek"></a>

### s3ListObjectsV2Queue.peek() ⇒ <code>Promise.&lt;Object&gt;</code>
View the next item in the queue

This does not remove the object from the queue.  When there are no more
items in the queue, returns 'null'.

**Kind**: instance method of [<code>S3ListObjectsV2Queue</code>](#S3ListObjectsV2Queue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an S3 object description  
<a name="S3ListObjectsV2Queue+shift"></a>

### s3ListObjectsV2Queue.shift() ⇒ <code>Promise.&lt;Object&gt;</code>
Remove the next item from the queue

When there are no more items in the queue, returns 'null'.

**Kind**: instance method of [<code>S3ListObjectsV2Queue</code>](#S3ListObjectsV2Queue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an S3 object description  
<a name="S3ObjectStore"></a>

## S3ObjectStore
Class to use when interacting with S3

**Kind**: global class  

* [S3ObjectStore](#S3ObjectStore)
    * [.signGetObject(objectUrl, [options], [queryParams], presignOptions)](#S3ObjectStore+signGetObject) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.signHeadObject(objectUrl, [options], [queryParams], presignOptions)](#S3ObjectStore+signHeadObject) ⇒ <code>Promise.&lt;string&gt;</code>

<a name="S3ObjectStore+signGetObject"></a>

### s3ObjectStore.signGetObject(objectUrl, [options], [queryParams], presignOptions) ⇒ <code>Promise.&lt;string&gt;</code>
Returns an HTTPS URL that can be used to perform a GET on the given object
store URL

**Kind**: instance method of [<code>S3ObjectStore</code>](#S3ObjectStore)  
**Returns**: <code>Promise.&lt;string&gt;</code> - a signed URL  
**Throws**:

- TypeError - if the URL is not a recognized protocol or cannot be parsed


| Param | Type | Description |
| --- | --- | --- |
| objectUrl | <code>string</code> | the URL of the object to sign |
| [options] | <code>string</code> | options to pass to S3.getObject |
| [queryParams] | <code>string</code> | a mapping of parameter key/values to put in the URL |
| presignOptions | <code>RequestPresigningArguments</code> | presignOptions |

<a name="S3ObjectStore+signHeadObject"></a>

### s3ObjectStore.signHeadObject(objectUrl, [options], [queryParams], presignOptions) ⇒ <code>Promise.&lt;string&gt;</code>
Returns an HTTPS URL that can be used to perform a HEAD on the given object
store URL

**Kind**: instance method of [<code>S3ObjectStore</code>](#S3ObjectStore)  
**Returns**: <code>Promise.&lt;string&gt;</code> - a signed URL  
**Throws**:

- TypeError - if the URL is not a recognized protocol or cannot be parsed


| Param | Type | Description |
| --- | --- | --- |
| objectUrl | <code>string</code> | the URL of the object to sign |
| [options] | <code>string</code> | options to pass to S3.getObject |
| [queryParams] | <code>string</code> | a mapping of parameter key/values to put in the URL |
| presignOptions | <code>RequestPresigningArguments</code> | presignOptions |

<a name="createKey"></a>

## createKey(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Create a KMS key

See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/KMS.html#createKey-property
for allowed params and return value.

**Kind**: global function  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="encrypt"></a>

## encrypt(KeyId, Plaintext) ⇒ <code>Promise.&lt;string&gt;</code>
Encrypt a string using KMS

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - the Base 64 encoding of the encrypted value  

| Param | Type | Description |
| --- | --- | --- |
| KeyId | <code>string</code> | the KMS key to use for encryption |
| Plaintext | <code>string</code> | the string to be encrypted |

<a name="decryptBase64String"></a>

## decryptBase64String(ciphertext) ⇒ <code>string</code>
Decrypt a KMS-encrypted string, Base 64 encoded

**Kind**: global function  
**Returns**: <code>string</code> - the plaintext  

| Param | Type | Description |
| --- | --- | --- |
| ciphertext | <code>string</code> | a KMS-encrypted value, Base 64 encoded |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's
future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

[localstack]: https://github.com/localstack/localstack

---
Generated automatically using `npm run build-docs`
