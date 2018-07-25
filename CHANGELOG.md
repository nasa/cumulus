# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.8.0] - 2018-07-23

### Added

- **CUMULUS-718** Adds integration test for Kinesis triggering a workflow.

- **GITC-776-3** Added more flexibility for rules.  You can now edit all fields on the rule's record
We may need to update the api documentation to reflect this.

- **CUMULUS-681** - Add ingest-in-place action to granules endpoint
    - new applyWorkflow action at PUT /granules/{granuleid} Applying a workflow starts an execution of the provided workflow and passes the granule record as payload.
      Parameter(s):
        - workflow - the workflow name
        - messageSource - 'input' or 'output' from previous execution
        - metaOverride - overrides the meta of the new execution, accepts partial override
        - payloadOverride - overrides the payload of the new execution, accepts partial override

- **CUMULUS-685** - Add parent exeuction arn to the execution which is triggered from a parent step function

### Changed
- **CUMULUS-768** - Integration tests get S3 provider data from shared data folder

### Fixed
- **CUMULUS-746** - Move granule API correctly updates record in dynamo DB and cmr xml file
- **CUMULUS-766** - Populate database fileSize field from S3 if value not present in Ingest payload


## [v1.7.1] - 2018-07-25

### Fixed
- **CUMULUS-766** - Backport - Populate database fileSize field from S3 if value not present in Ingest payload


## [v1.7.0] - 2018-07-02

### Please note: [Upgrade Instructions](https://nasa.github.io/cumulus/upgrade/1.7.0.html)

### Added
- **GITC-776-1**
  - Added support for SFTP using public/private keys that can optionally be encrypted/decrypted using KMS
  There is an assumption that private key is located in s3://bucketInternal/stackName/crypto. KMS can be used to encrypt/decrypt the keys. Provider schema has been extended to support optional fields (privateKey, cmKeyId)

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
- **CUMULUS-398** - Fix not able to filter executions bu workflow
- **CUMULUS-748** - Fix invalid lambda .zip files being validated/uploaded to AWS
- **CUMULUS-544** - Post to CMR task has UAT URL hard-coded
  - Made configurable: PostToCmr now requires CMR_ENVIRONMENT env to be set to 'SIT' or 'OPS' for those CMR environments. Default is UAT.

### Changed
- **CUMULUS-710** - In the integration test suite, `getStepOutput` returns the output of the first successful step execution or last failed, if none exists

## [v1.6.0] - 2018-06-06

### Please note: [Upgrade Instructions](https://nasa.github.io/cumulus/upgrade/1.6.0.html)

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
- `@cumulus/deployment`'s default cloudformation template now configures storage for Docker to match the configured ECS Volume. The template defines Docker's devicemapper basesize (`dm.basesize`) using `ecs.volumeSize`. This is addresses ECS default of limiting Docker containers to 10GB of storage ([Read more](https://aws.amazon.com/premiumsupport/knowledge-center/increase-default-ecs-docker-limit/)).

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

[Unreleased]: https://github.com/nasa/cumulus/compare/v1.8.0...HEAD
[v1.8.0]: https://github.com/nasa/cumulus/compare/v1.7.1...v1.8.0
[v1.7.1]: https://github.com/nasa/cumulus/compare/v1.7.0...v1.7.1
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
