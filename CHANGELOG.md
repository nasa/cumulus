# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.11.2] - 2018-2-15

### Added
- CUMULUS-1103 Compare the collection holdings in CMR with Cumulus' internal data store
- CUMULUS-1099 Add support for UMMG JSON metadata versions > 1.4.
    - If a version is found in the metadata object, that version is used for processing and publishing to CMR otherwise, version 1.4 is assumed.
- CUMULUS-678
    - Added support for UMMG json v1.4 metadata files.
  `reconcileCMRMetadata` added to `@cumulus/cmrjs` to update metadata record with new file locations.
  `@cumulus/common/errors` adds two new error types `CMRMetaFileNotFound` and `InvalidArgument`.
  `@cumulus/common/test-utils` adds new function `randomId` to create a random string with id to help in debugging.
  `@cumulus/common/BucketsConfig` adds a new helper class `BucketsConfig` for working with bucket stack configuration and bucket names.
  `@cumulus/common/aws` adds new function `s3PutObjectTagging` as a convenience for the aws  [s3().putObjectTagging](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObjectTagging-property) function.
  `@cumulus/cmrjs` Adds:
        - `isCMRFile` - Identify an echo10(xml) or UMMG(json) metadata file.
        - `metadataObjectFromCMRFile` Read and parse CMR XML file from s3.
        - `updateCMRMetadata` Modify a cmr metadata (xml/json) file with updated information.
        - `publish2CMR` Posts XML or UMMG CMR data to CMR service.
        - `reconcileCMRMetadata` Reconciles cmr metadata file after a file moves.
- Adds some ECS and other permissions to StepRole to enable running ECS tasks from a workflow
- Added Apache logs to cumulus api and distribution lambdas
- **CUMULUS-1119** - Added `@cumulus/integration-tests/api/EarthdataLogin.getEarthdataLoginRedirectResponse` helper for integration tests to handle login with Earthdata and to return response from redirect to Cumulus API
- **CUMULUS-673** Added `@cumulus/common/file/getFileChecksumFromStream` to get file checksum from a readable stream

### Fixed
- CUMULUS-1123
  - Cloudformation template overrides now work as expected

### Changed
- CUMULUS-1121
  - Schema validation is now strongly enforced when writing to the database.
    Additional properties are not allowed and will result in a validation error.
- CUMULUS-678
  `tasks/move-granules` simplified and refactored to use  functionality from cmrjs.
  `ingest/granules.moveGranuleFiles` now just moves granule files and returns a list of the updated files. Updating metadata now handled by `@cumulus/cmrjs/reconcileCMRMetadata`.
  `move-granules.updateGranuleMetadata` refactored and bugs fixed in the case of a file matching multiple collection.files.regexps.
  `getCmrXmlFiles` simplified and now only returns an object with the cmrfilename and the granuleId.
  `@cumulus/test-processing` - test processing task updated to generate UMM-G metadata

- CUMULUS-1043
  - `@cumulus/api` now uses [express](http://expressjs.com/) as the API engine.
  - All `@cumulus/api` endpoints on ApiGateway are consolidated to a single endpoint the uses `{proxy+}` definition.
  - All files under `packages/api/endpoints` along with associated tests are updated to support express's request and response objects.
  - Replaced environment variables `internal`, `bucket` and `systemBucket` with `system_bucket`.
  - Update `@cumulus/integration-tests` to work with updated cumulus-api express endpoints

- `@cumulus/integration-tests` - `buildAndExecuteWorkflow` and `buildWorkflow` updated to take a `meta` param to allow for additional fields to be added to the workflow `meta`

- **CUMULUS-1049** Updated `Retrieve Execution Status API` in `@cumulus/api`: If the execution doesn't exist in Step Function API, Cumulus API returns the execution status information from the database.

- **CUMULUS-1119**
  - Renamed `DISTRIBUTION_URL` environment variable to `DISTRIBUTION_ENDPOINT`
  - Renamed `DEPLOYMENT_ENDPOINT` environment variable to `DISTRIBUTION_REDIRECT_ENDPOINT`
  - Renamed `API_ENDPOINT` environment variable to `TOKEN_REDIRECT_ENDPOINT`

### Removed
- Functions deprecated before 1.11.0:
  - @cumulus/api/models/base: static Manager.createTable() and static Manager.deleteTable()
  - @cumulus/ingest/aws/S3
  - @cumulus/ingest/aws/StepFunction.getExecution()
  - @cumulus/ingest/aws/StepFunction.pullEvent()
  - @cumulus/ingest/consumer.Consume
  - @cumulus/ingest/granule/Ingest.getBucket()

### Deprecated
`@cmrjs/ingestConcept`, instead use the CMR object methods. `@cmrjs/CMR.ingestGranule` or `@cmrjs/CMR.ingestCollection`
`@cmrjs/searchConcept`, instead use the CMR object methods. `@cmrjs/CMR.searchGranules` or `@cmrjs/CMR.searchCollections`
`@cmrjs/deleteConcept`, instead use the CMR object methods. `@cmrjs/CMR.deleteGranule` or `@cmrjs/CMR.deleteCollection`


## [v1.11.1] - 2018-12-18

**Please Note**
- Ensure your `app/config.yml` has a `clientId` specified in the `cmr` section. This will allow CMR to identify your requests for better support and metrics.
  - For an example, please see [the example config](https://github.com/nasa/cumulus/blob/1c7e2bf41b75da9f87004c4e40fbcf0f39f56794/example/app/config.yml#L128).

### Added

- Added a `/tokenDelete` endpoint in `@cumulus/api` to delete access token records

### Changed

- CUMULUS-678
`@cumulus/ingest/crypto` moved and renamed to `@cumulus/common/key-pair-provider`
`@cumulus/ingest/aws` function:  `KMSDecryptionFailed` and class: `KMS` extracted and moved to `@cumulus/common` and `KMS` is exported as `KMSProvider` from `@cumulus/common/key-pair-provider`
`@cumulus/ingest/granule` functions: `publish`, `getGranuleId`, `getXMLMetadataAsString`, `getMetadataBodyAndTags`, `parseXmlString`, `getCmrXMLFiles`, `postS3Object`, `contructOnlineAccessUrls`, `updateMetadata`, extracted and moved to `@cumulus/cmrjs`
`getGranuleId`, `getCmrXMLFiles`, `publish`, `updateMetadata` removed from `@cumulus/ingest/granule` and added to `@cumulus/cmrjs`;
`updateMetadata` renamed `updateCMRMetadata`.
`@cumulus/ingest` test files renamed.
- **CUMULUS-1070**
  - Add `'Client-Id'` header to all `@cumulus/cmrjs` requests (made via `searchConcept`, `ingestConcept`, and `deleteConcept`).
  - Updated `cumulus/example/app/config.yml` entry for `cmr.clientId` to use stackName for easier CMR-side identification.

## [v1.11.0] - 2018-11-30

**Please Note**
- Redeploy IAM roles:
  - CUMULUS-817 includes a migration that requires reconfiguration/redeployment of IAM roles.  Please see the [upgrade instructions](https://nasa.github.io/cumulus/docs/upgrade/1.11.0) for more information.
  - CUMULUS-977 includes a few new SNS-related permissions added to the IAM roles that will require redeployment of IAM roles.
- `cumulus-message-adapter` v1.0.13+ is required for `@cumulus/api` granule reingest API to work properly.  The latest version should be downloaded automatically by kes.
- A `TOKEN_SECRET` value (preferably 256-bit for security) must be added to `.env` to securely sign JWTs used for authorization in `@cumulus/api`

### Changed

- **CUUMULUS-1000** - Distribution endpoint now persists logins, instead of
  redirecting to Earthdata Login on every request
- **CUMULUS-783 CUMULUS-790** - Updated `@cumulus/sync-granule` and `@cumulus/move-granules` tasks to always overwrite existing files for manually-triggered reingest.
- **CUMULUS-906** - Updated `@cumulus/api` granule reingest API to
  - add `reingestGranule: true` and `forceDuplicateOverwrite: true` to Cumulus message `cumulus_meta.cumulus_context` field to indicate that the workflow is a manually triggered re-ingest.
  - return warning message to operator when duplicateHandling is not `replace`
  - `cumulus-message-adapter` v1.0.13+ is required.
- **CUMULUS-793** - Updated the granule move PUT request in `@cumulus/api` to reject the move with a 409 status code if one or more of the files already exist at the destination location
- Updated `@cumulus/helloworld` to use S3 to store state for pass on retry tests
- Updated `@cumulus/ingest`:
  - [Required for MAAP] `http.js#list` will now find links with a trailing whitespace
  - Removed code from `granule.js` which looked for files in S3 using `{ Bucket: discoveredFile.bucket, Key: discoveredFile.name }`. This is obsolete since `@cumulus/ingest` uses a `file-staging` and `constructCollectionId()` directory prefixes by default.
- **CUMULUS-989**
  - Updated `@cumulus/api` to use [JWT (JSON Web Token)](https://jwt.io/introduction/) as the transport format for API authorization tokens and to use JWT verification in the request authorization
  - Updated `/token` endpoint in `@cumulus/api` to return tokens as JWTs
  - Added a `/refresh` endpoint in `@cumulus/api` to request new access tokens from the OAuth provider using the refresh token
  - Added `refreshAccessToken` to `@cumulus/api/lib/EarthdataLogin` to manage refresh token requests with the Earthdata OAuth provider

### Added
- **CUMULUS-1050**
  - Separated configuration flags for originalPayload/finalPayload cleanup such that they can be set to different retention times
- **CUMULUS-798**
  - Added daily Executions cleanup CloudWatch event that triggers cleanExecutions lambda
  - Added cleanExecutions lambda that removes finalPayload/originalPayload field entries for records older than configured timeout value (execution_payload_retention_period), with a default of 30 days
- **CUMULUS-815/816**
  - Added 'originalPayload' and 'finalPayload' fields to Executions table
  - Updated Execution model to populate originalPayload with the execution payload on record creation
  - Updated Execution model code to populate finalPayload field with the execution payload on execution completion
  - Execution API now exposes the above fields
- **CUMULUS-977**
  - Rename `kinesisConsumer` to `messageConsumer` as it handles both Kinesis streams and SNS topics as of this version.
  - Add `sns`-type rule support. These rules create a subscription between an SNS topic and the `messageConsumer`.
    When a message is received, `messageConsumer` is triggered and passes the SNS message (JSON format expected) in
    its entirety to the workflow in the `payload` field of the Cumulus message. For more information on sns-type rules,
    see the [documentation](https://nasa.github.io/cumulus/docs/data-cookbooks/setup#rules).
- **CUMULUS-975**
  - Add `KinesisInboundEventLogger` and `KinesisOutboundEventLogger` API lambdas.  These lambdas
    are utilized to dump incoming and outgoing ingest workflow kinesis streams
    to cloudwatch for analytics in case of AWS/stream failure.
  - Update rules model to allow tracking of log_event ARNs related to
    Rule event logging.    Kinesis rule types will now automatically log
    incoming events via a Kinesis event triggered lambda.
 CUMULUS-975-migration-4
  - Update migration code to require explicit migration names per run
  - Added migration_4 to migrate/update exisitng Kinesis rules to have a log event mapping
  - Added new IAM policy for migration lambda
- **CUMULUS-775**
  - Adds a instance metadata endpoint to the `@cumulus/api` package.
  - Adds a new convenience function `hostId` to the `@cumulus/cmrjs` to help build environment specific cmr urls.
  - Fixed `@cumulus/cmrjs.searchConcept` to search and return CMR results.
  - Modified `@cumulus/cmrjs.CMR.searchGranule` and `@cumulus/cmrjs.CMR.searchCollection` to include CMR's provider as a default parameter to searches.
- **CUMULUS-965**
  - Add `@cumulus/test-data.loadJSONTestData()`,
    `@cumulus/test-data.loadTestData()`, and
    `@cumulus/test-data.streamTestData()` to safely load test data. These
    functions should be used instead of using `require()` to load test data,
    which could lead to tests interferring with each other.
  - Add a `@cumulus/common/util/deprecate()` function to mark a piece of code as
    deprecated
- **CUMULUS-986**
  - Added `waitForTestExecutionStart` to `@cumulus/integration-tests`
- **CUMULUS-919**
  - In `@cumulus/deployment`, added support for NGAP permissions boundaries for IAM roles with `useNgapPermissionBoundary` flag in `iam/config.yml`. Defaults to false.

### Fixed
- Fixed a bug where FTP sockets were not closed after an error, keeping the Lambda function active until it timed out [CUMULUS-972]
- **CUMULUS-656**
  - The API will no longer allow the deletion of a provider if that provider is
    referenced by a rule
  - The API will no longer allow the deletion of a collection if that collection
    is referenced by a rule
- Fixed a bug where `@cumulus/sf-sns-report` was not pulling large messages from S3 correctly.

### Deprecated
- `@cumulus/ingest/aws/StepFunction.pullEvent()`. Use `@cumulus/common/aws.pullStepFunctionEvent()`.
- `@cumulus/ingest/consumer.Consume` due to unpredictable implementation. Use `@cumulus/ingest/consumer.Consumer`.
Call `Consumer.consume()` instead of `Consume.read()`.

## [v1.10.4] - 2018-11-28

### Added
- **CUMULUS-1008**
  - New `config.yml` parameter for SQS consumers: `sqs_consumer_rate: (default 500)`, which is the maximum number of
  messages the consumer will attempt to process per execution. Currently this is only used by the sf-starter consumer,
  which runs every minute by default, making this a messages-per-minute upper bound. SQS does not guarantee the number
  of messages returned per call, so this is not a fixed rate of consumption, only attempted number of messages received.

### Deprecated
- `@cumulus/ingest/consumer.Consume` due to unpredictable implementation. Use `@cumulus/ingest/consumer.Consumer`.

### Changed
- Backported update of `packages/api` dependency `@mapbox/dyno` to `1.4.2` to mitigate `event-stream` vulnerability.

## [v1.10.3] - 2018-10-31

### Added
- **CUMULUS-817**
  - Added AWS Dead Letter Queues for lambdas that are scheduled asynchronously/such that failures show up only in cloudwatch logs.
- **CUMULUS-956**
  - Migrated developer documentation and data-cookbooks to Docusaurus
    - supports versioning of documentation
  - Added `docs/docs-how-to.md` to outline how to do things like add new docs or locally install for testing.
  - Deployment/CI scripts have been updated to work with the new format
- **CUMULUS-811**
  - Added new S3 functions to `@cumulus/common/aws`:
    - `aws.s3TagSetToQueryString`: converts S3 TagSet array to querystring (for use with upload()).
    - `aws.s3PutObject`: Returns promise of S3 `putObject`, which puts an object on S3
    - `aws.s3CopyObject`: Returns promise of S3 `copyObject`, which copies an object in S3 to a new S3 location
    - `aws.s3GetObjectTagging`: Returns promise of S3 `getObjectTagging`, which returns an object containing an S3 TagSet.
  - `@/cumulus/common/aws.s3PutObject` defaults to an explicit `ACL` of 'private' if not overridden.
  - `@/cumulus/common/aws.s3CopyObject` defaults to an explicit `TaggingDirective` of 'COPY' if not overridden.

### Deprecated
- **CUMULUS-811**
  - Deprecated `@cumulus/ingest/aws.S3`. Member functions of this class will now
    log warnings pointing to similar functionality in `@cumulus/common/aws`.

## [v1.10.2] - 2018-10-24

### Added
- **CUMULUS-965**
  - Added a `@cumulus/logger` package
- **CUMULUS-885**
  - Added 'human readable' version identifiers to Lambda Versioning lambda aliases
- **CUMULUS-705**
  - Note: Make sure to update the IAM stack when deploying this update.
  - Adds an AsyncOperations model and associated DynamoDB table to the
    `@cumulus/api` package
  - Adds an /asyncOperations endpoint to the `@cumulus/api` package, which can
    be used to fetch the status of an AsyncOperation.
  - Adds a /bulkDelete endpoint to the `@cumulus/api` package, which performs an
    asynchronous bulk-delete operation. This is a stub right now which is only
    intended to demonstration how AsyncOperations work.
  - Adds an AsyncOperation ECS task to the `@cumulus/api` package, which will
    fetch an Lambda function, run it in ECS, and then store the result to the
    AsyncOperations table in DynamoDB.
- **CUMULUS-851** - Added workflow lambda versioning feature to allow in-flight workflows to use lambda versions that were in place when a workflow was initiated
    - Updated Kes custom code to remove logic that used the CMA file key to determine template compilation logic.  Instead, utilize a `customCompilation` template configuration flag to indicate a template should use Cumulus's kes customized methods instead of 'core'.
    - Added `useWorkflowLambdaVersions` configuration option to enable the lambdaVersioning feature set.   **This option is set to true by default** and should be set to false to disable the feature.
    - Added uniqueIdentifier configuration key to S3 sourced lambdas to optionally support S3 lambda resource versioning within this scheme. This key must be unique for each modified version of the lambda package and must be updated in configuration each time the source changes.
    - Added a new nested stack template that will create a `LambdaVersions` stack that will take lambda parameters from the base template, generate lambda versions/aliases and return outputs with references to the most 'current' lambda alias reference, and updated 'core' template to utilize these outputs (if `useWorkflowLambdaVersions` is enabled).

- Created a `@cumulus/api/lib/OAuth2` interface, which is implemented by the
  `@cumulus/api/lib/EarthdataLogin` and `@cumulus/api/lib/GoogleOAuth2` classes.
  Endpoints that need to handle authentication will determine which class to use
  based on environment variables. This also greatly simplifies testing.
- Added `@cumulus/api/lib/assertions`, containing more complex AVA test assertions
- Added PublishGranule workflow to publish a granule to CMR without full reingest. (ingest-in-place capability)

- `@cumulus/integration-tests` new functionality:
  - `listCollections` to list collections from a provided data directory
  - `deleteCollection` to delete list of collections from a deployed stack
  - `cleanUpCollections` combines the above in one function.
  - `listProviders` to list providers from a provided data directory
  - `deleteProviders` to delete list of providers from a deployed stack
  - `cleanUpProviders` combines the above in one function.
  - `@cumulus/integrations-tests/api.js`: `deleteGranule` and `deletePdr` functions to make `DELETE` requests to Cumulus API
  - `rules` API functionality for posting and deleting a rule and listing all rules
  - `wait-for-deploy` lambda for use in the redeployment tests
- `@cumulus/ingest/granule.js`: `ingestFile` inserts new `duplicate_found: true` field in the file's record if a duplicate file already exists on S3.
- `@cumulus/api`: `/execution-status` endpoint requests and returns complete execution output if  execution output is stored in S3 due to size.
- Added option to use environment variable to set CMR host in `@cumulus/cmrjs`.
- **CUMULUS-781** - Added integration tests for `@cumulus/sync-granule` when `duplicateHandling` is set to `replace` or `skip`
- **CUMULUS-791** - `@cumulus/move-granules`: `moveFileRequest` inserts new `duplicate_found: true` field in the file's record if a duplicate file already exists on S3. Updated output schema to document new `duplicate_found` field.

### Removed

- Removed `@cumulus/common/fake-earthdata-login-server`. Tests can now create a
  service stub based on `@cumulus/api/lib/OAuth2` if testing requires handling
  authentication.

### Changed

- **CUMULUS-940** - modified `@cumulus/common/aws` `receiveSQSMessages` to take a parameter object instead of positional parameters.  All defaults remain the same, but now access to long polling is available through `options.waitTimeSeconds`.
- **CUMULUS-948** - Update lambda functions `CNMToCMA` and `CnmResponse` in the `cumulus-data-shared` bucket and point the default stack to them.
- **CUMULUS-782** - Updated `@cumulus/sync-granule` task and `Granule.ingestFile` in `@cumulus/ingest` to keep both old and new data when a destination file with different checksum already exists and `duplicateHandling` is `version`
- Updated the config schema in `@cumulus/move-granules` to include the `moveStagedFiles` param.
- **CUMULUS-778** - Updated config schema and documentation in `@cumulus/sync-granule` to include `duplicateHandling` parameter for specifying how duplicate filenames should be handled
- **CUMULUS-779** - Updated `@cumulus/sync-granule` to throw `DuplicateFile` error when destination files already exist and `duplicateHandling` is `error`
- **CUMULUS-780** - Updated `@cumulus/sync-granule` to use `error` as the default for `duplicateHandling` when it is not specified
- **CUMULUS-780** - Updated `@cumulus/api` to use `error` as the default value for `duplicateHandling` in the `Collection` model
- **CUMULUS-785** - Updated the config schema and documentation in `@cumulus/move-granules` to include `duplicateHandling` parameter for specifying how duplicate filenames should be handled
- **CUMULUS-786, CUMULUS-787** - Updated `@cumulus/move-granules` to throw `DuplicateFile` error when destination files already exist and `duplicateHandling` is `error` or not specified
- **CUMULUS-789** - Updated `@cumulus/move-granules` to keep both old and new data when a destination file with different checksum already exists and `duplicateHandling` is `version`

### Fixed

- `getGranuleId` in `@cumulus/ingest` bug: `getGranuleId` was constructing an error using `filename` which was undefined. The fix replaces `filename` with the `uri` argument.
- Fixes to `del` in `@cumulus/api/endpoints/granules.js` to not error/fail when not all files exist in S3 (e.g. delete granule which has only 2 of 3 files ingested).
- `@cumulus/deployment/lib/crypto.js` now checks for private key existence properly.

## [v1.10.1] - 2018-09-4

### Fixed

- Fixed cloudformation template errors in `@cumulus/deployment/`
  - Replaced references to Fn::Ref: with Ref:
  - Moved long form template references to a newline

## [v1.10.0] - 2018-08-31

### Removed

- Removed unused and broken code from `@cumulus/common`
  - Removed `@cumulus/common/test-helpers`
  - Removed `@cumulus/common/task`
  - Removed `@cumulus/common/message-source`
  - Removed the `getPossiblyRemote` function from `@cumulus/common/aws`
  - Removed the `startPromisedSfnExecution` function from `@cumulus/common/aws`
  - Removed the `getCurrentSfnTask` function from `@cumulus/common/aws`

### Changed

- **CUMULUS-839** - In `@cumulus/sync-granule`, 'collection' is now an optional config parameter

### Fixed

- **CUMULUS-859** Moved duplicate code in `@cumulus/move-granules` and `@cumulus/post-to-cmr` to `@cumulus/ingest`. Fixed imports making assumptions about directory structure.
- `@cumulus/ingest/consumer` correctly limits the number of messages being received and processed from SQS. Details:
  - **Background:** `@cumulus/api` includes a lambda `<stack-name>-sqs2sf` which processes messages from the `<stack-name>-startSF` SQS queue every minute. The `sqs2sf` lambda uses `@cumulus/ingest/consumer` to receive and process messages from SQS.
  - **Bug:** More than `messageLimit` number of messages were being consumed and processed from the `<stack-name>-startSF` SQS queue. Many step functions were being triggered simultaneously by the lambda `<stack-name>-sqs2sf` (which consumes every minute from the `startSF` queue) and resulting in step function failure with the error: `An error occurred (ThrottlingException) when calling the GetExecutionHistory`.
  - **Fix:** `@cumulus/ingest/consumer#processMessages` now processes messages until `timeLimit` has passed _OR_ once it receives up to `messageLimit` messages. `sqs2sf` is deployed with a [default `messageLimit` of 10](https://github.com/nasa/cumulus/blob/670000c8a821ff37ae162385f921c40956e293f7/packages/deployment/app/config.yml#L147).
  - **IMPORTANT NOTE:** `consumer` will actually process up to `messageLimit * 2 - 1` messages. This is because sometimes `receiveSQSMessages` will return less than `messageLimit` messages and thus the consumer will continue to make calls to `receiveSQSMessages`. For example, given a `messageLimit` of 10 and subsequent calls to `receiveSQSMessages` returns up to 9 messages, the loop will continue and a final call could return up to 10 messages.


## [v1.9.1] - 2018-08-22

**Please Note** To take advantage of the added granule tracking API functionality, updates are required for the message adapter and its libraries. You should be on the following versions:
- `cumulus-message-adapter` 1.0.9+
- `cumulus-message-adapter-js` 1.0.4+
- `cumulus-message-adapter-java` 1.2.7+
- `cumulus-message-adapter-python` 1.0.5+

### Added

- **CUMULUS-687** Added logs endpoint to search for logs from a specific workflow execution in `@cumulus/api`. Added integration test.
- **CUMULUS-836** - `@cumulus/deployment` supports a configurable docker storage driver for ECS. ECS can be configured with either `devicemapper` (the default storage driver for AWS ECS-optimized AMIs) or `overlay2` (the storage driver used by the NGAP 2.0 AMI). The storage driver can be configured in `app/config.yml` with `ecs.docker.storageDriver: overlay2 | devicemapper`. The default is `overlay2`.
  - To support this configuration, a [Handlebars](https://handlebarsjs.com/) helper `ifEquals` was added to `packages/deployment/lib/kes.js`.
- **CUMULUS-836** - `@cumulus/api` added IAM roles required by the NGAP 2.0 AMI. The NGAP 2.0 AMI runs a script `register_instances_with_ssm.py` which requires the ECS IAM role to include `ec2:DescribeInstances` and `ssm:GetParameter` permissions.

### Fixed
- **CUMULUS-836** - `@cumulus/deployment` uses `overlay2` driver by default and does not attempt to write `--storage-opt dm.basesize` to fix [this error](https://github.com/moby/moby/issues/37039).
- **CUMULUS-413** Kinesis processing now captures all errrors.
  - Added kinesis fallback mechanism when errors occur during record processing.
  - Adds FallbackTopicArn to `@cumulus/api/lambdas.yml`
  - Adds fallbackConsumer lambda to `@cumulus/api`
  - Adds fallbackqueue option to lambda definitions capture lambda failures after three retries.
  - Adds kinesisFallback SNS topic to signal incoming errors from kinesis stream.
  - Adds kinesisFailureSQS to capture fully failed events from all retries.
- **CUMULUS-855** Adds integration test for kinesis' error path.
- **CUMULUS-686** Added workflow task name and version tracking via `@cumulus/api` executions endpoint under new `tasks` property, and under `workflow_tasks` in step input/output.
  - Depends on `cumulus-message-adapter` 1.0.9+, `cumulus-message-adapter-js` 1.0.4+, `cumulus-message-adapter-java` 1.2.7+ and `cumulus-message-adapter-python` 1.0.5+
- **CUMULUS-771**
  - Updated sync-granule to stream the remote file to s3
  - Added integration test for ingesting granules from ftp provider
  - Updated http/https integration tests for ingesting granules from http/https providers
- **CUMULUS-862** Updated `@cumulus/integration-tests` to handle remote lambda output
- **CUMULUS-856** Set the rule `state` to have default value `ENABLED`

### Changed

- In `@cumulus/deployment`, changed the example app config.yml to have additional IAM roles

## [v1.9.0] - 2018-08-06

**Please note** additional information and upgrade instructions [here](https://nasa.github.io/cumulus/docs/upgrade/1.9.0)

### Added
- **CUMULUS-712** - Added integration tests verifying expected behavior in workflows
- **GITC-776-2** - Add support for versioned collections

### Fixed
- **CUMULUS-832**
  - Fixed indentation in example config.yml in `@cumulus/deployment`
  - Fixed issue with new deployment using the default distribution endpoint in `@cumulus/deployment` and `@cumulus/api`

## [v1.8.1] - 2018-08-01

**Note** IAM roles should be re-deployed with this release.

- **Cumulus-726**
  - Added function to `@cumulus/integration-tests`: `sfnStep` includes `getStepInput` which returns the input to the schedule event of a given step function step.
  - Added IAM policy `@cumulus/deployment`: Lambda processing IAM role includes `kinesis::PutRecord` so step function lambdas can write to kinesis streams.
- **Cumulus Community Edition**
  - Added Google OAuth authentication token logic to `@cumulus/api`. Refactored token endpoint to use environment variable flag `OAUTH_PROVIDER` when determining with authentication method to use.
  - Added API Lambda memory configuration variable `api_lambda_memory` to `@cumulus/api` and `@cumulus/deployment`.

### Changed

- **Cumulus-726**
  - Changed function in `@cumulus/api`: `models/rules.js#addKinesisEventSource` was modified to call to `deleteKinesisEventSource` with all required parameters (rule's name, arn and type).
  - Changed function in `@cumulus/integration-tests`: `getStepOutput` can now be used to return output of failed steps. If users of this function want the output of a failed event, they can pass a third parameter `eventType` as `'failure'`. This function will work as always for steps which completed successfully.

### Removed

- **Cumulus-726**
  - Configuration change to `@cumulus/deployment`: Removed default auto scaling configuration for Granules and Files DynamoDB tables.

- **CUMULUS-688**
  - Add integration test for ExecutionStatus
  - Function addition to `@cumulus/integration-tests`: `api` includes `getExecutionStatus` which returns the execution status from the Cumulus API

## [v1.8.0] - 2018-07-23

### Added

- **CUMULUS-718** Adds integration test for Kinesis triggering a workflow.

- **GITC-776-3** Added more flexibility for rules.  You can now edit all fields on the rule's record
We may need to update the api documentation to reflect this.

- **CUMULUS-681** - Add ingest-in-place action to granules endpoint
    - new applyWorkflow action at PUT /granules/{granuleid} Applying a workflow starts an execution of the provided workflow and passes the granule record as payload.
      Parameter(s):
        - workflow - the workflow name

- **CUMULUS-685** - Add parent exeuction arn to the execution which is triggered from a parent step function

### Changed
- **CUMULUS-768** - Integration tests get S3 provider data from shared data folder

### Fixed
- **CUMULUS-746** - Move granule API correctly updates record in dynamo DB and cmr xml file
- **CUMULUS-766** - Populate database fileSize field from S3 if value not present in Ingest payload

## [v1.7.1] - 2018-07-27

### Fixed
- **CUMULUS-766** - Backport from 1.8.0 - Populate database fileSize field from S3 if value not present in Ingest payload

## [v1.7.0] - 2018-07-02

### Please note: [Upgrade Instructions](https://nasa.github.io/cumulus/docs/upgrade/1.7.0)

### Added
- **GITC-776-2** - Add support for versioned collectons
- **CUMULUS-491** - Add granule reconciliation API endpoints.
- **CUMULUS-480** Add suport for backup and recovery:
  - Add DynamoDB tables for granules, executions and pdrs
  - Add ability to write all records to S3
  - Add ability to download all DynamoDB records in form json files
  - Add ability to upload records to DynamoDB
  - Add migration scripts for copying granule, pdr and execution records from ElasticSearch to DynamoDB
  - Add IAM support for batchWrite on dynamoDB
-
- **CUMULUS-508** - `@cumulus/deployment` cloudformation template allows for lambdas and ECS clusters to have multiple AZ availability.
    - `@cumulus/deployment` also ensures docker uses `devicemapper` storage driver.
- **CUMULUS-755** - `@cumulus/deployment` Add DynamoDB autoscaling support.
    - Application developers can add autoscaling and override default values in their deployment's `app/config.yml` file using a `{TableName}Table:` key.

### Fixed
- **CUMULUS-747** - Delete granule API doesn't delete granule files in s3 and granule in elasticsearch
    - update the StreamSpecification DynamoDB tables to have StreamViewType: "NEW_AND_OLD_IMAGES"
    - delete granule files in s3
- **CUMULUS-398** - Fix not able to filter executions by workflow
- **CUMULUS-748** - Fix invalid lambda .zip files being validated/uploaded to AWS
- **CUMULUS-544** - Post to CMR task has UAT URL hard-coded
  - Made configurable: PostToCmr now requires CMR_ENVIRONMENT env to be set to 'SIT' or 'OPS' for those CMR environments. Default is UAT.

### Changed
- **GITC-776-4** - Changed Discover-pdrs to not rely on collection but use provider_path in config. It also has an optional filterPdrs regex configuration parameter

- **CUMULUS-710** - In the integration test suite, `getStepOutput` returns the output of the first successful step execution or last failed, if none exists

## [v1.6.0] - 2018-06-06

### Please note: [Upgrade Instructions](https://nasa.github.io/cumulus/docs/upgrade/1.6.0)

### Fixed
- **CUMULUS-602** - Format all logs sent to Elastic Search.
  - Extract cumulus log message and index it to Elastic Search.

### Added
- **CUMULUS-556** - add a mechanism for creating and running migration scripts on deployment.
- **CUMULUS-461** Support use of metadata date and other components in `url_path` property

### Changed
- **CUMULUS-477** Update bucket configuration to support multiple buckets of the same type:
  - Change the structure of the buckets to allow for  more than one bucket of each type. The bucket structure is now:
    bucket-key:
      name: <bucket-name>
      type: <type> i.e. internal, public, etc.
  - Change IAM and app deployment configuration to support new bucket structure
  - Update tasks and workflows to support new bucket structure
  - Replace instances where buckets.internal is relied upon to either use the system bucket or a configured bucket
  - Move IAM template to the deployment package. NOTE: You now have to specify '--template node_modules/@cumulus/deployment/iam' in your IAM deployment
  - Add IAM cloudformation template support to filter buckets by type

## [v1.5.5] - 2018-05-30

### Added
- **CUMULUS-530** - PDR tracking through Queue-granules
  - Add optional `pdr` property to the sync-granule task's input config and output payload.
- **CUMULUS-548** - Create a Lambda task that generates EMS distribution reports
  - In order to supply EMS Distribution Reports, you must enable S3 Server
    Access Logging on any S3 buckets used for distribution. See [How Do I Enable Server Access Logging for an S3 Bucket?](https://docs.aws.amazon.com/AmazonS3/latest/user-guide/server-access-logging.html)
    The "Target bucket" setting should point at the Cumulus internal bucket.
    The "Target prefix" should be
    "<STACK_NAME>/ems-distribution/s3-server-access-logs/", where "STACK_NAME"
    is replaced with the name of your Cumulus stack.

### Fixed
- **CUMULUS-546 - Kinesis Consumer should catch and log invalid JSON**
  - Kinesis Consumer lambda catches and logs errors so that consumer doesn't get stuck in a loop re-processing bad json records.
- EMS report filenames are now based on their start time instead of the time
  instead of the time that the report was generated
- **CUMULUS-552 - Cumulus API returns different results for the same collection depending on query**
  - The collection, provider and rule records in elasticsearch are now replaced with records from dynamo db when the dynamo db records are updated.

### Added
- `@cumulus/deployment`'s default cloudformation template now configures storage for Docker to match the configured ECS Volume. The template defines Docker's devicemapper basesize (`dm.basesize`) using `ecs.volumeSize`. This addresses ECS default of limiting Docker containers to 10GB of storage ([Read more](https://aws.amazon.com/premiumsupport/knowledge-center/increase-default-ecs-docker-limit/)).

## [v1.5.4] - 2018-05-21

### Added
- **CUMULUS-535** - EMS Ingest, Archive, Archive Delete reports
  - Add lambda EmsReport to create daily EMS Ingest, Archive, Archive Delete reports
  - ems.provider property added to `@cumulus/deployment/app/config.yml`.
    To change the provider name, please add `ems: provider` property to `app/config.yml`.
- **CUMULUS-480** Use DynamoDB to store granules, pdrs and execution records
  - Activate PointInTime feature on DynamoDB tables
  - Increase test coverage on api package
  - Add ability to restore metadata records from json files to DynamoDB
- **CUMULUS-459** provide API endpoint for moving granules from one location on s3 to another

## [v1.5.3] - 2018-05-18

### Fixed
- **CUMULUS-557 - "Add dataType to DiscoverGranules output"**
  - Granules discovered by the DiscoverGranules task now include dataType
  - dataType is now a required property for granules used as input to the
    QueueGranules task
- **CUMULUS-550** Update deployment app/config.yml to force elasticsearch updates for deleted granules

## [v1.5.2] - 2018-05-15

### Fixed
- **CUMULUS-514 - "Unable to Delete the Granules"**
  - updated cmrjs.deleteConcept to return success if the record is not found
    in CMR.

### Added
- **CUMULUS-547** - The distribution API now includes an
  "earthdataLoginUsername" query parameter when it returns a signed S3 URL
- **CUMULUS-527 - "parse-pdr queues up all granules and ignores regex"**
  - Add an optional config property to the ParsePdr task called
    "granuleIdFilter". This property is a regular expression that is applied
    against the filename of the first file of each granule contained in the
    PDR. If the regular expression matches, then the granule is included in
    the output. Defaults to '.', which will match all granules in the PDR.
- File checksums in PDRs now support MD5
- Deployment support to subscribe to an SNS topic that already exists
- **CUMULUS-470, CUMULUS-471** In-region S3 Policy lambda added to API to update bucket policy for in-region access.
- **CUMULUS-533** Added fields to granule indexer to support EMS ingest and archive record creation
- **CUMULUS-534** Track deleted granules
  - added `deletedgranule` type to `cumulus` index.
  - **Important Note:** Force custom bootstrap to re-run by adding this to
    app/config.yml `es: elasticSearchMapping: 7`
- You can now deploy cumulus without ElasticSearch. Just add `es: null` to your `app/config.yml` file. This is only useful for debugging purposes. Cumulus still requires ElasticSearch to properly operate.
- `@cumulus/integration-tests` includes and exports the `addRules` function, which seeds rules into the DynamoDB table.
- Added capability to support EFS in cloud formation template. Also added
  optional capability to ssh to your instance and privileged lambda functions.
- Added support to force discovery of PDRs that have already been processed
  and filtering of selected data types
- `@cumulus/cmrjs` uses an environment variable `USER_IP_ADDRESS` or fallback
  IP address of `10.0.0.0` when a public IP address is not available. This
  supports lambda functions deployed into a VPC's private subnet, where no
  public IP address is available.

### Changed
- **CUMULUS-550** Custom bootstrap automatically adds new types to index on
  deployment

## [v1.5.1] - 2018-04-23
### Fixed
- add the missing dist folder to the hello-world task
- disable uglifyjs on the built version of the pdr-status-check (read: https://github.com/webpack-contrib/uglifyjs-webpack-plugin/issues/264)

## [v1.5.0] - 2018-04-23
### Changed
- Removed babel from all tasks and packages and increased minimum node requirements to version 8.10
- Lambda functions created by @cumulus/deployment will use node8.10 by default
- Moved [cumulus-integration-tests](https://github.com/nasa/cumulus-integration-tests) to the `example` folder CUMULUS-512
- Streamlined all packages dependencies (e.g. remove redundant dependencies and make sure versions are the same across packages)
- **CUMULUS-352:** Update Cumulus Elasticsearch indices to use [index aliases](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-aliases.html).
- **CUMULUS-519:** ECS tasks are no longer restarted after each CF deployment unless `ecs.restartTasksOnDeploy` is set to true
- **CUMULUS-298:** Updated log filterPattern to include all CloudWatch logs in ElasticSearch
- **CUMULUS-518:** Updates to the SyncGranule config schema
  - `granuleIdExtraction` is no longer a property
  - `process` is now an optional property
  - `provider_path` is no longer a property

### Fixed
- **CUMULUS-455 "Kes deployments using only an updated message adapter do not get automatically deployed"**
  - prepended the hash value of cumulus-message-adapter.zip file to the zip file name of lambda which uses message adapter.
  - the lambda function will be redeployed when message adapter or lambda function are updated
- Fixed a bug in the bootstrap lambda function where it stuck during update process
- Fixed a bug where the sf-sns-report task did not return the payload of the incoming message as the output of the task [CUMULUS-441]

### Added
- **CUMULUS-352:** Add reindex CLI to the API package.
- **CUMULUS-465:** Added mock http/ftp/sftp servers to the integration tests
- Added a `delete` method to the `@common/CollectionConfigStore` class
- **CUMULUS-467 "@cumulus/integration-tests or cumulus-integration-tests should seed provider and collection in deployed DynamoDB"**
  - `example` integration-tests populates providers and collections to database
  - `example` workflow messages are populated from workflow templates in s3, provider and collection information in database, and input payloads.  Input templates are removed.
  - added `https` protocol to provider schema

## [v1.4.1] - 2018-04-11

### Fixed
- Sync-granule install

## [v1.4.0] - 2018-04-09

### Fixed
- **CUMULUS-392 "queue-granules not returning the sfn-execution-arns queued"**
  - updated queue-granules to return the sfn-execution-arns queued and pdr if exists.
  - added pdr to ingest message meta.pdr instead of payload, so the pdr information doesn't get lost in the ingest workflow, and ingested granule in elasticsearch has pdr name.
  - fixed sf-sns-report schema, remove the invalid part
  - fixed pdr-status-check schema, the failed execution contains arn and reason
- **CUMULUS-206** make sure homepage and repository urls exist in package.json files of tasks and packages

### Added
- Example folder with a cumulus deployment example

### Changed
- [CUMULUS-450](https://bugs.earthdata.nasa.gov/browse/CUMULUS-450) - Updated
  the config schema of the **queue-granules** task
  - The config no longer takes a "collection" property
  - The config now takes an "internalBucket" property
  - The config now takes a "stackName" property
- [CUMULUS-450](https://bugs.earthdata.nasa.gov/browse/CUMULUS-450) - Updated
  the config schema of the **parse-pdr** task
  - The config no longer takes a "collection" property
  - The "stack", "provider", and "bucket" config properties are now
    required
- **CUMULUS-469** Added a lambda to the API package to prototype creating an S3 bucket policy for direct, in-region S3 access for the prototype bucket

### Removed
- Removed the `findTmpTestDataDirectory()` function from
  `@cumulus/common/test-utils`

### Fixed
- [CUMULUS-450](https://bugs.earthdata.nasa.gov/browse/CUMULUS-450)
  - The **queue-granules** task now enqueues a **sync-granule** task with the
    correct collection config for that granule based on the granule's
    data-type. It had previously been using the collection config from the
    config of the **queue-granules** task, which was a problem if the granules
    being queued belonged to different data-types.
  - The **parse-pdr** task now handles the case where a PDR contains granules
    with different data types, and uses the correct granuleIdExtraction for
    each granule.

### Added
- **CUMULUS-448** Add code coverage checking using [nyc](https://github.com/istanbuljs/nyc).

## [v1.3.0] - 2018-03-29

### Deprecated
- discover-s3-granules is deprecated. The functionality is provided by the discover-granules task
### Fixed
- **CUMULUS-331:** Fix aws.downloadS3File to handle non-existent key
- Using test ftp provider for discover-granules testing [CUMULUS-427]
- **CUMULUS-304: "Add AWS API throttling to pdr-status-check task"** Added concurrency limit on SFN API calls.  The default concurrency is 10 and is configurable through Lambda environment variable CONCURRENCY.
- **CUMULUS-414: "Schema validation not being performed on many tasks"** revised npm build scripts of tasks that use cumulus-message-adapter to place schema directories into dist directories.
- **CUMULUS-301:** Update all tests to use test-data package for testing data.
- **CUMULUS-271: "Empty response body from rules PUT endpoint"** Added the updated rule to response body.
- Increased memory allotment for `CustomBootstrap` lambda function. Resolves failed deployments where `CustomBootstrap` lambda function was failing with error `Process exited before completing request`. This was causing deployments to stall, fail to update and fail to rollback. This error is thrown when the lambda function tries to use more memory than it is allotted.
- Cumulus repository folders structure updated:
  - removed the `cumulus` folder altogether
  - moved `cumulus/tasks` to `tasks` folder at the root level
  - moved the tasks that are not converted to use CMA to `tasks/.not_CMA_compliant`
  - updated paths where necessary

### Added
- `@cumulus/integration-tests` - Added support for testing the output of an ECS activity as well as a Lambda function.

## [v1.2.0] - 2018-03-20

### Fixed
- Update vulnerable npm packages [CUMULUS-425]
- `@cumulus/api`: `kinesis-consumer.js` uses `sf-scheduler.js#schedule` instead of placing a message directly on the `startSF` SQS queue. This is a fix for [CUMULUS-359](https://bugs.earthdata.nasa.gov/browse/CUMULUS-359) because `sf-scheduler.js#schedule` looks up the provider and collection data in DynamoDB and adds it to the `meta` object of the enqueued message payload.
- `@cumulus/api`: `kinesis-consumer.js` catches and logs errors instead of doing an error callback. Before this change, `kinesis-consumer` was failing to process new records when an existing record caused an error because it would call back with an error and stop processing additional records. It keeps trying to process the record causing the error because it's "position" in the stream is unchanged. Catching and logging the errors is part 1 of the fix. Proposed part 2 is to enqueue the error and the message on a "dead-letter" queue so it can be processed later ([CUMULUS-413](https://bugs.earthdata.nasa.gov/browse/CUMULUS-413)).
- **CUMULUS-260: "PDR page on dashboard only shows zeros."** The PDR stats in LPDAAC are all 0s, even if the dashboard has been fixed to retrieve the correct fields.  The current version of pdr-status-check has a few issues.
  - pdr is not included in the input/output schema.  It's available from the input event.  So the pdr status and stats are not updated when the ParsePdr workflow is complete.  Adding the pdr to the input/output of the task will fix this.
  - pdr-status-check doesn't update pdr stats which prevent the real time pdr progress from showing up in the dashboard. To solve this, added lambda function sf-sns-report which is copied from @cumulus/api/lambdas/sf-sns-broadcast with modification, sf-sns-report can be used to report step function status anywhere inside a step function.  So add step sf-sns-report after each pdr-status-check, we will get the PDR status progress at real time.
  - It's possible an execution is still in the queue and doesn't exist in sfn yet.  Added code to handle 'ExecutionDoesNotExist' error when checking the execution status.
- Fixed `aws.cloudwatchevents()` typo in `packages/ingest/aws.js`. This typo was the root cause of the error: `Error: Could not process scheduled_ingest, Error: : aws.cloudwatchevents is not a constructor` seen when trying to update a rule.


### Removed

- `@cumulus/ingest/aws`: Remove queueWorkflowMessage which is no longer being used by `@cumulus/api`'s `kinesis-consumer.js`.

## [v1.1.4] - 2018-03-15

### Added
- added flag `useList` to parse-pdr [CUMULUS-404]

### Fixed

- Pass encrypted password to the ApiGranule Lambda function [CUMULUS-424]


## [v1.1.3] - 2018-03-14
### Fixed
- Changed @cumulus/deployment package install behavior. The build process will happen after installation

## [v1.1.2] - 2018-03-14

### Added
- added tools to @cumulus/integration-tests for local integration testing
- added end to end testing for discovering and parsing of PDRs
- `yarn e2e` command is available for end to end testing
### Fixed

- **CUMULUS-326: "Occasionally encounter "Too Many Requests" on deployment"** The api gateway calls will handle throttling errors
- **CUMULUS-175: "Dashboard providers not in sync with AWS providers."** The root cause of this bug - DynamoDB operations not showing up in Elasticsearch - was shared by collections and rules. The fix was to update providers', collections' and rules; POST, PUT and DELETE endpoints to operate on DynamoDB and using DynamoDB streams to update Elasticsearch. The following packages were made:
  - `@cumulus/deployment` deploys DynamoDB streams for the Collections, Providers and Rules tables as well as a new lambda function called `dbIndexer`. The `dbIndexer` lambda has an event source mapping which listens to each of the DynamoDB streams. The dbIndexer lambda receives events referencing operations on the DynamoDB table and updates the elasticsearch cluster accordingly.
  - The `@cumulus/api` endpoints for collections, providers and rules _only_ query DynamoDB, with the exception of LIST endpoints and the collections' GET endpoint.

### Updated
- Broke up `kes.override.js` of @cumulus/deployment to multiple modules and moved to a new location
- Expanded @cumulus/deployment test coverage
- all tasks were updated to use cumulus-message-adapter-js 1.0.1
- added build process to integration-tests package to babelify it before publication
- Update @cumulus/integration-tests lambda.js `getLambdaOutput` to return the entire lambda output. Previously `getLambdaOutput` returned only the payload.

## [v1.1.1] - 2018-03-08

### Removed
- Unused queue lambda in api/lambdas [CUMULUS-359]

### Fixed
- Kinesis message content is passed to the triggered workflow [CUMULUS-359]
- Kinesis message queues a workflow message and does not write to rules table [CUMULUS-359]

## [v1.1.0] - 2018-03-05

### Added

- Added a `jlog` function to `common/test-utils` to aid in test debugging
- Integration test package with command line tool [CUMULUS-200] by @laurenfrederick
- Test for FTP `useList` flag [CUMULUS-334] by @kkelly51

### Updated
- The `queue-pdrs` task now uses the [cumulus-message-adapter-js](https://github.com/nasa/cumulus-message-adapter-js)
  library
- Updated the `queue-pdrs` JSON schemas
- The test-utils schema validation functions now throw an error if validation
  fails
- The `queue-granules` task now uses the [cumulus-message-adapter-js](https://github.com/nasa/cumulus-message-adapter-js)
  library
- Updated the `queue-granules` JSON schemas

### Removed
- Removed the `getSfnExecutionByName` function from `common/aws`
- Removed the `getGranuleStatus` function from `common/aws`

## [v1.0.1] - 2018-02-27

### Added
- More tests for discover-pdrs, dicover-granules by @yjpa7145
- Schema validation utility for tests by @yjpa7145

### Changed
- Fix an FTP listing bug for servers that do not support STAT [CUMULUS-334] by @kkelly51

## [v1.0.0] - 2018-02-23

[Unreleased]: https://github.com/nasa/cumulus/compare/v1.11.2...HEAD
[v1.11.2]: https://github.com/nasa/cumulus/compare/v1.11.0...v1.11.2
[v1.11.1]: https://github.com/nasa/cumulus/compare/v1.11.0...v1.11.1
[v1.11.0]: https://github.com/nasa/cumulus/compare/v1.10.4...v1.11.0
[v1.10.4]: https://github.com/nasa/cumulus/compare/v1.10.3...v1.10.4
[v1.10.3]: https://github.com/nasa/cumulus/compare/v1.10.2...v1.10.3
[v1.10.2]: https://github.com/nasa/cumulus/compare/v1.10.1...v1.10.2
[v1.10.1]: https://github.com/nasa/cumulus/compare/v1.10.0...v1.10.1
[v1.10.0]: https://github.com/nasa/cumulus/compare/v1.9.1...v1.10.0
[v1.9.1]: https://github.com/nasa/cumulus/compare/v1.9.0...v1.9.1
[v1.9.0]: https://github.com/nasa/cumulus/compare/v1.8.1...v1.9.0
[v1.8.1]: https://github.com/nasa/cumulus/compare/v1.8.0...v1.8.1
[v1.8.0]: https://github.com/nasa/cumulus/compare/v1.7.0...v1.8.0
[v1.7.0]: https://github.com/nasa/cumulus/compare/v1.6.0...v1.7.0
[v1.6.0]: https://github.com/nasa/cumulus/compare/v1.5.5...v1.6.0
[v1.5.5]: https://github.com/nasa/cumulus/compare/v1.5.4...v1.5.5
[v1.5.4]: https://github.com/nasa/cumulus/compare/v1.5.3...v1.5.4
[v1.5.3]: https://github.com/nasa/cumulus/compare/v1.5.2...v1.5.3
[v1.5.2]: https://github.com/nasa/cumulus/compare/v1.5.1...v1.5.2
[v1.5.1]: https://github.com/nasa/cumulus/compare/v1.5.0...v1.5.1
[v1.5.0]: https://github.com/nasa/cumulus/compare/v1.4.1...v1.5.0
[v1.4.1]: https://github.com/nasa/cumulus/compare/v1.4.0...v1.4.1
[v1.4.0]: https://github.com/nasa/cumulus/compare/v1.3.0...v1.4.0
[v1.3.0]: https://github.com/nasa/cumulus/compare/v1.2.0...v1.3.0
[v1.2.0]: https://github.com/nasa/cumulus/compare/v1.1.4...v1.2.0
[v1.1.4]: https://github.com/nasa/cumulus/compare/v1.1.3...v1.1.4
[v1.1.3]: https://github.com/nasa/cumulus/compare/v1.1.2...v1.1.3
[v1.1.2]: https://github.com/nasa/cumulus/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/nasa/cumulus/compare/v1.0.1...v1.1.1
[v1.1.0]: https://github.com/nasa/cumulus/compare/v1.0.1...v1.1.0
[v1.0.1]: https://github.com/nasa/cumulus/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/nasa/cumulus/compare/pre-v1-release...v1.0.0
