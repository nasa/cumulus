# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/).

## Unreleased

### Migration Notes

For the v16.1 release series, Cumulus Core will be tested against PostgreSQL v13. Users
should migrate their datastores to Aurora PostgreSQL 13.12+ compatible data
stores as soon as possible after upgrading to this release.

**IMPORTANT** -- When upgrading from v16.1.x users should update to a release
following 18.2.0/the first forward release supporting Postgres v13, as versions
between 16.1.x and 18.2.x+ are unsupported on Aurora Postgres v13.

#### Database Upgrade

Users utilizing the `cumulus-rds-tf` module should reference [cumulus-rds-tf
upgrade
instructions](https://nasa.github.io/cumulus/docs/upgrade-notes/upgrade-rds-cluster-tf-postgres-13).

## Changed
- **CUMULUS-3564**
  - Update webpack configuration to explicitly disable chunking
- **CUMULUS-3444**
  - Update `cumulus-rds-tf` module to take additional parameters in support of
    migration from Aurora PostgreSQl v11 to v13.   See Migration Notes for more details.


## [v16.1.4] 2024-2-16

Please note changes in 16.1.4 may not yet be released in future versions, as this
is a backport/patch release on the 16.x series of releases. Updates that are
included in the future will have a corresponding CHANGELOG entry in future releases.

### Fixed
- **CUMULUS-3547**
  - Updated ECS Cluster `/dev/xvdcz` EBS volumes so they're encrypted.
  - addressed DAR requirement for encryption


## [v16.1.3] 2024-1-15

Please note changes in 16.1.3 may not yet be released in future versions, as this
is a backport/patch release on the 16.x series of releases. Updates that are
included in the future will have a corresponding CHANGELOG entry in future releases.

### Changed

- **CUMULUS_3499
  - Update AWS-SDK dependency pin to "2.1490" to prevent SQS issue.  Dependency
    pin expected to be changed with the resolution to CUMULUS-2900

### Fixed

- **CUMULUS-3474**
  - Fixed overriden changes to `rules.buildPayload' to restore changes from
    ticket `CUMULUS-2969` which limited the definition object to `name` and `arn` to
    account for AWS character limits.
- **CUMULUS-3501**
  - Updated CreateReconciliationReport lambda to save report record to Elasticsearch.
  - Created docker image cumuluss/async-operation:48 from v16.1.2, and used it as default async_operation_image.
- **CUMULUS-3510**
  - Fixed `@cumulus/api` `validateAndUpdateSqsRule` method to allow 0 retries and 0 visibilityTimeout
    in rule's meta.  This fix from CUMULUS-2863 was not in release 16 and later.
- **CUMULUS-3540**
  - stubbed cmr interfaces in integration tests allow integration tests to pass
  - needed while cmr is failing to continue needed releases and progress
  - this change should be reverted ASAP when cmr is working as needed again

## [v16.1.2] 2023-11-01

### Added

- **CUMULUS-3218**
  - Added optional `maxDownloadTime` field to `provider` schema
  - Added `max_download_time` column to PostgreSQL `providers` table
  - Updated `@cumulus/ingest/lock` to check expired locks based on `provider.maxDownloadTime`

### Fixed

- **@aws-sdk upgrade**
  - Fixed TS compilation error on aws-client package caused by @aws-sdk/client-dynamodb 3.433.0 upgrade
  - Updated mapping for collection Elasticsearch records to prevent dynamic field for keys under `meta`.
- **CUMULUS-3286**
  - Fixed `@cumulus/cmrjs/cmr-utils/getGranuleTemporalInfo` and `@cumulus/message/Granules/getGranuleCmrTemporalInfo`
    to handle non-existing cmr file.
  - Updated mapping for granule and deletedgranule Elasticsearch records to prevent dynamic field for keys under
    `queryFields`.
- **CUMULUS-3293**
  - Process Dead Letter Archive is fixed to properly copy objects from `/sqs/` to `/failed-sqs/` location
- **CUMULUS-3393**
  - Fixed `PUT` collection endpoint to update collection configuration in S3.
- **CUMULUS-3467**
  - Added `childWorkflowMeta` to `QueueWorkflow` task configuration

## [v16.1.1] 2023-08-03

### Notable Changes

- The async_operation_image property of cumulus module should be updated to pull
  the ECR image for cumuluss/async-operation:47

### Added

- **CUMULUS-3298**
  - Added extra time to the buffer for replacing the launchpad token before it expires to alleviate CMR error messages
- **CUMULUS-3220**
  - Created a new send-pan task
- **CUMULUS-3287**
  - Added variable to allow the aws_ecs_task_definition health check to be configurable.
  - Added clarity to how the bucket field needs to be configured for the move-granules task definition

### Changed

- Security upgrade node from 14.19.3-buster to 14.21.1-buster
- **CUMULUS-2985**
  - Changed `onetime` rules RuleTrigger to only execute when the state is `ENABLED` and updated documentation to reflect the change
  - Changed the `invokeRerun` function to only re-run enabled rules
- **CUMULUS-3188**
  - Updated QueueGranules to support queueing granules that meet the required API granule schema.
  - Added optional additional properties to queue-granules input schema
- **CUMULUS-3252**
  - Updated example/cumulus-tf/orca.tf to use orca v8.0.1
  - Added cumulus task `@cumulus/orca-copy-to-archive-adapter`, and add the task to `tf-modules/ingest`
  - Updated `tf-modules/cumulus` module to take variable `orca_lambda_copy_to_archive_arn` and pass to `tf-modules/ingest`
  - Updated `example/cumulus-tf/ingest_and_publish_granule_with_orca_workflow.tf` `CopyToGlacier` (renamed to `CopyToArchive`) step to call
    `orca_copy_to_archive_adapter_task`
- **CUMULUS-3253**
  - Added cumulus task `@cumulus/orca-recovery-adapter`, and add the task to `tf-modules/ingest`
  - Updated `tf-modules/cumulus` module to take variable `orca_sfn_recovery_workflow_arn` and pass to `tf-modules/ingest`
  - Added `example/cumulus-tf/orca_recovery_adapter_workflow.tf`, `OrcaRecoveryAdapterWorkflow` workflow has `OrcaRecoveryAdapter` task
    to call the ORCA recovery step-function.
  - Updated `example/data/collections/` collection configuration `meta.granuleRecoveryWorkflow` to use `OrcaRecoveryAdapterWorkflow`
- **CUMULUS-3215**
  - Create reconciliation reports will properly throw errors and set the async
    operation status correctly to failed if there is an error.
  - Knex calls relating to reconciliation reports will retry if there is a
    connection terminated unexpectedly error
  - Improved logging for async operation
  - Set default async_operation_image_version to 47
- **CUMULUS-3024**
  - Combined unit testing of @cumulus/api/lib/rulesHelpers to a single test file
    `api/tests/lib/test-rulesHelpers` and removed extraneous test files.
- **CUMULUS-3209**
  - Apply brand color with high contrast settings for both (light and dark) themes.
  - Cumulus logo can be seen when scrolling down.
  - "Back to Top" button matches the brand color for both themes.
  - Update "note", "info", "tip", "caution", and "warning" components to [new admonition styling](https://docusaurus.io/docs/markdown-features/admonitions).
  - Add updated arch diagram for both themes.
- **CUMULUS-3203**
  - Removed ACL setting of private on S3.multipartCopyObject() call
  - Removed ACL setting of private for s3PutObject()
  - Removed ACL confguration on sync-granules task
  - Update documentation on dashboard deployment to exclude ACL public-read setting
- **CUMULUS-3245**
  - Update SQS consumer logic to catch ExecutionAlreadyExists error and
    delete SQS message accordingly.
  - Add ReportBatchItemFailures to event source mapping start_sf_mapping
- Added missing name to throttle_queue_watcher Cloudwatch event in `throttled-queue.tf`

### Fixed

- **CUMULUS-2625**
  - Optimized heap memory and api load in queue-granules task to scale to larger workloads.
- **CUMULUS-3265**
  - Fixed `@cumulus/api` `getGranulesForPayload` function to query cloud metrics es when needed.

## [v16.0.0] 2023-05-09

### Notable Changes

- The async_operation_image property of cumulus module should be updated to pull
  the ECR image for cumuluss/async-operation:46

### MIGRATION notes

#### PI release version

When updating directly to v16 from prior releases older that V15, please make sure to
read through all prior release notes.

Notable migration concerns since the last PI release version (11.1.x):

- [v14.1.0] - Postgres compatibility update to Aurora PostgreSQL 11.13.
- [v13.1.0] - Postgres update to add `files_granules_cumulus_id_index` to the
  `files` table may require manual steps depending on load.

#### RDS Phase 3 migration notes

This release includes updates that remove existing DynamoDB tables as part of
release deployment process.   This release *cannot* be properly rolled back in
production as redeploying a prior version of Cumulus will not recover the
associated Dynamo tables.

Please read the full change log for RDS Phase 3 and consult the [RDS Phase 3 update
documentation](https://nasa.github.io/cumulus/docs/next/upgrade-notes/upgrade-rds-phase-3-release)

#### API Endpoint Versioning

As part of the work on CUMULUS-3072, we have added a required header for the
granule PUT/PATCH endpoints -- to ensure that older clients/utilities do not
unexpectedly make destructive use of those endpoints, a validation check of a
header value against supported versions has been implemented.

Moving forward, if a breaking change is made to an existing endpoint that
requires user updates, as part of that update we will set the current version of
the core API and require a header that confirms the client is compatible with
the version required or greater.

In this instance, the granule PUT/PATCH
endpoints will require a `Cumulus-API-Version` value of at least `2`.

```bash
 curl --request PUT https://example.com/granules/granuleId.A19990103.006.1000\
 --header 'Cumulus-API-Version': '2'\
 --header 'Authorization: Bearer ReplaceWithToken'\
 --data ...
```

Users/clients that do not make use of these endpoints will not be impacted.

### RDS Phase 3
#### Breaking Changes

- **CUMULUS-2688**
  - Updated bulk operation logic to use collectionId in addition to granuleId to fetch granules.
  - Tasks using the `bulk-operation` Lambda should provide collectionId and granuleId e.g. { granuleId: xxx, collectionId: xxx }
- **CUMULUS-2856**
  - Update execution PUT endpoint to no longer respect message write constraints and update all values passed in

#### Changed

- **CUMULUS-3282**
  - Updated internal granule endpoint parameters from :granuleName to :granuleId
    for maintenance/consistency reasons
- **CUMULUS-2312** - RDS Migration Epic Phase 3
  - **CUMULUS-2645**
    - Removed unused index functionality for all tables other than
      `ReconciliationReportsTable` from `dbIndexer` lambda
  - **CUMULUS-2398**
    - Remove all dynamoDB updates for `@cumulus/api/ecs/async-operation/*`
    - Updates all api endpoints with updated signature for
      `asyncOperationsStart` calls
    - Remove all dynamoDB models calls from async-operations api endpoints
  - **CUMULUS-2801**
    - Move `getFilesExistingAtLocation`from api granules model to api/lib, update granules put
      endpoint to remove model references
  - **CUMULUS-2804**
    - Updates api/lib/granule-delete.deleteGranuleAndFiles:
      - Updates dynamoGranule -> apiGranule in the signature and throughout the dependent code
      - Updates logic to make apiGranule optional, but pgGranule required, and
        all lookups use postgres instead of ES/implied apiGranule values
      - Updates logic to make pgGranule optional - in this case the logic removes the entry from ES only
    - Removes all dynamo model logic from api/endpoints/granules
    - Removes dynamo write logic from api/lib/writeRecords.*
    - Removes dynamo write logic from api/lib/ingest.*
    - Removes all granule model calls from api/lambdas/bulk-operations and any dependencies
    - Removes dynamo model calls from api/lib/granule-remove-from-cmr.unpublishGranule
    - Removes Post Deployment execution check from sf-event-sqs-to-db-records
    - Moves describeGranuleExecution from api granule model to api/lib/executions.js
  - **CUMULUS-2806**
    - Remove DynamoDB logic from executions `POST` endpoint
    - Remove DynamoDB logic from sf-event-sqs-to-db-records lambda execution writes.
    - Remove DynamoDB logic from executions `PUT` endpoint
  - **CUMULUS-2808**
    - Remove DynamoDB logic from executions `DELETE` endpoint
  - **CUMULUS-2809**
    - Remove DynamoDB logic from providers `PUT` endpoint
    - Updates DB models asyncOperation, provider and rule to return all fields on upsert.
  - **CUMULUS-2810**
    - Removes addition of DynamoDB record from API endpoint POST /provider/<name>
  - **CUMULUS-2811**
    - Removes deletion of DynamoDB record from API endpoint DELETE /provider/<name>
  - **CUMULUS-2817**
    - Removes deletion of DynamoDB record from API endpoint DELETE /collection/<name>/<version>
  - **CUMULUS-2814**
    - Move event resources deletion logic from `rulesModel` to `rulesHelper`
  - **CUMULUS-2815**
    - Move File Config and Core Config validation logic for Postgres Collections from `api/models/collections.js` to `api/lib/utils.js`
  - **CUMULUS-2813**
    - Removes creation and deletion of DynamoDB record from API endpoint POST /rules/
  - **CUMULUS-2816**
    - Removes addition of DynamoDB record from API endpoint POST /collections
  - **CUMULUS-2797**
    - Move rule helper functions to separate rulesHelpers file
  - **CUMULUS-2821**
    - Remove DynamoDB logic from `sfEventSqsToDbRecords` lambda
  - **CUMULUS-2856**
    - Update API/Message write logic to handle nulls as deletion in execution PUT/message write logic

#### Added

- **CUMULUS-2312** - RDS Migration Epic Phase 3
  - **CUMULUS-2813**
    - Added function `create` in the `db` model for Rules
      to return an array of objects containing all columns of the created record.
  - **CUMULUS-2812**
    - Move event resources logic from `rulesModel` to `rulesHelper`
  - **CUMULUS-2820**
    - Remove deletion of DynamoDB record from API endpoint DELETE /pdr/<pdrName>
  - **CUMULUS-2688**
    - Add new endpoint to fetch granules by collectionId as well as granuleId: GET /collectionId/granuleId
    - Add new endpoints to update and delete granules by collectionId as well as
      granuleId

#### Removed

- **CUMULUS-2994**
  - Delete code/lambdas that publish DynamoDB stream events to SNS
- **CUMULUS-3226**
  - Removed Dynamo Async Operations table
- **CUMULUS-3199**
  - Removed DbIndexer lambda and all associated terraform resources
- **CUMULUS-3009**
  - Removed Dynamo PDRs table
- **CUMULUS-3008**
  - Removed DynamoDB Collections table
- **CUMULUS-2815**
  - Remove update of DynamoDB record from API endpoint PUT /collections/<name>/<version>
- **CUMULUS-2814**
  - Remove DynamoDB logic from rules `DELETE` endpoint
- **CUMULUS-2812**
  - Remove DynamoDB logic from rules `PUT` endpoint
- **CUMULUS-2798**
  - Removed AsyncOperations model
- **CUMULUS-2797**
- **CUMULUS-2795**
  - Removed API executions model
- **CUMULUS-2796**
  - Remove API pdrs model and all related test code
  - Remove API Rules model and all related test code
- **CUMULUS-2794**
  - Remove API Collections model and all related test code
  - Remove lambdas/postgres-migration-count-tool, api/endpoints/migrationCounts and api-client/migrationCounts
  - Remove lambdas/data-migration1 tool
  - Remove lambdas/data-migration2 and
    lambdas/postgres-migration-async-operation
- **CUMULUS-2793**
  - Removed Provider Dynamo model and related test code
- **CUMULUS-2792**
  - Remove API Granule model and all related test code
  - Remove granule-csv endpoint
- **CUMULUS-2645**
  - Removed dynamo structural migrations and related code from `@cumulus/api`
  - Removed `executeMigrations` lambda
  - Removed `granuleFilesCacheUpdater` lambda
  - Removed dynamo files table from `data-persistence` module.  *This table and
    all of its data will be removed on deployment*.

### Added
- **CUMULUS-3072**
  - Added `replaceGranule` to `@cumulus/api-client/granules` to add usage of the
    updated RESTful PUT logic
- **CUMULUS-3121**
  - Added a map of variables for the cloud_watch_log retention_in_days for the various cloudwatch_log_groups, as opposed to keeping them hardcoded at 30 days. Can be configured by adding the <module>_<cloudwatch_log_group_name>_log_retention value in days to the cloudwatch_log_retention_groups map variable
- **CUMULUS-3201**
  - Added support for sha512 as checksumType for LZARDs backup task.

### Changed

- **CUMULUS-3315**
  - Updated `@cumulus/api-client/granules.bulkOperation` to remove `ids`
    parameter in favor of `granules` parameter, in the form of a
    `@cumulus/types/ApiGranule` that requires the following keys: `[granuleId, collectionId]`
- **CUMULUS-3307**
  - Pinned cumulus dependency on `pg` to `v8.10.x`
- **CUMULUS-3279**
  - Updated core dependencies on `xml2js` to `v0.5.0`
  - Forcibly updated downstream dependency for `xml2js` in `saml2-js` to
    `v0.5.0`
  - Added audit-ci CVE override until July 1 to allow for Core package releases
- **CUMULUS-3106**
  - Updated localstack version to 1.4.0 and removed 'skip' from all skipped tests
- **CUMULUS-3115**
  - Fixed DiscoverGranules' workflow's duplicateHandling when set to `skip` or `error` to stop retrying
    after receiving a 404 Not Found Response Error from the `cumulus-api`.
- **CUMULUS-3165**
  - Update example/cumulus-tf/orca.tf to use orca v6.0.3

### Fixed

- **CUMULUS-3315**
  - Update CI scripts to use shell logic/GNU timeout to bound test timeouts
    instead of NPM `parallel` package, as timeouts were not resulting in
    integration test failure
- **CUMULUS-3223**
  - Update `@cumulus/cmrjs/cmr-utils.getGranuleTemporalInfo` to handle the error when the cmr file s3url is not available
  - Update `sfEventSqsToDbRecords` lambda to return [partial batch failure](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting),
    and only reprocess messages when cumulus message can't be retrieved from the execution events.
  - Update `@cumulus/cumulus-message-adapter-js` to `2.0.5` for all cumulus tasks

## [v15.0.4] 2023-06-23

### Changed

- **CUMULUS-3307**
  - Pinned cumulus dependency on `pg` to `v8.10.x`

### Fixed

- **CUMULUS-3115**
  - Fixed DiscoverGranules' workflow's duplicateHandling when set to `skip` or `error` to stop retrying
    after receiving a 404 Not Found Response Error from the `cumulus-api`.
- **CUMULUS-3315**
  - Update CI scripts to use shell logic/GNU timeout to bound test timeouts
    instead of NPM `parallel` package, as timeouts were not resulting in
    integration test failure
- **CUMULUS-3223**
  - Update `@cumulus/cmrjs/cmr-utils.getGranuleTemporalInfo` to handle the error when the cmr file s3url is not available
  - Update `sfEventSqsToDbRecords` lambda to return [partial batch failure](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting),
    and only reprocess messages when cumulus message can't be retrieved from the execution events.
  - Update `@cumulus/cumulus-message-adapter-js` to `2.0.5` for all cumulus tasks

## [v15.0.3] 2023-04-28

### Fixed

- **CUMULUS-3243**
  - Updated granule delete logic to delete granule which is not in DynamoDB
  - Updated granule unpublish logic to handle granule which is not in DynamoDB and/or CMR

## [v15.0.2] 2023-04-25

### Fixed

- **CUMULUS-3120**
  - Fixed a bug by adding in `default_log_retention_periods` and `cloudwatch_log_retention_periods`
  to Cumulus modules so they can be used during deployment for configuring cloudwatch retention periods, for more information check here: [retention document](https://nasa.github.io/cumulus/docs/configuration/cloudwatch-retention)
  - Updated cloudwatch retention documentation to reflect the bugfix changes

## [v15.0.1] 2023-04-20

### Changed

- **CUMULUS-3279**
  - Updated core dependencies on `xml2js` to `v0.5.0`
  - Forcibly updated downstream dependency for `xml2js` in `saml2-js` to
    `v0.5.0`
  - Added audit-ci CVE override until July 1 to allow for Core package releases

## Fixed

- **CUMULUS-3285**
  - Updated `api/lib/distribution.js isAuthBearTokenRequest` to handle non-Bearer authorization header

## [v15.0.0] 2023-03-10

### Breaking Changes

- **CUMULUS-3147**
  - The minimum supported version for all published Cumulus Core npm packages is now Node 16.19.0
  - Tasks using the `cumuluss/cumulus-ecs-task` Docker image must be updated to `cumuluss/cumulus-ecs-task:1.9.0.` which is built with node:16.19.0-alpine.  This can be done by updating the `image` property of any tasks defined using the `cumulus_ecs_service` Terraform module.
  - Updated Dockerfile of async operation docker image to build from node:16.19.0-buster
  - Published new tag [`44` of `cumuluss/async-operation` to Docker Hub](https://hub.docker.com/layers/cumuluss/async-operation/44/images/sha256-8d757276714153e4ab8c24a2b7b6b9ffee14cc78b482d9924e7093af88362b04?context=explore).
  - The `async_operation_image` property of `cumulus` module must be updated to pull the ECR image for `cumuluss/async-operation:44`.

### Changed

- **CUMULUS-2997**
  - Migrate Cumulus Docs to Docusaurus v2 and DocSearch v3.
- **CUMULUS-3044**
  - Deployment section:
    - Consolidate and migrate Cumulus deployment (public facing) content from wiki to Cumulus Docs in GitHub.
    - Update links to make sure that the user can maintain flow between the wiki and GitHub deployment documentation.
    - Organize and update sidebar to include categories for similar deployment topics.
- **CUMULUS-3147**
  - Set example/cumulus-tf default async_operation_image_version to 44.
  - Set example/cumulus-tf default ecs_task_image_version to 1.9.0.
- **CUMULUS-3166**
  - Updated example/cumulus-tf/thin_egress_app.tf to use tea 1.3.2

### Fixed

- **CUMULUS-3187**
  - Restructured Earthdata Login class to be individual methods as opposed to a Class Object
  - Removed typescript no-checks and reformatted EarthdataLogin code to be more type friendly

## [v14.1.0] 2023-02-27

### MIGRATION notes

#### PostgreSQL compatibility update

From this release forward Core will be tested against PostgreSQL 11   Existing
release compatibility testing was done for release 11.1.8/14.0.0+.   Users
should migrate their datastores to Aurora PostgreSQL 11.13+ compatible data stores
as soon as possible.

Users utilizing the `cumulus-rds-tf` module will have upgraded/had their
database clusters forcibly upgraded at the next maintenance window after 31 Jan
2023.   Our guidance to mitigate this issue is to do a manual (outside of
terraform) upgrade.   This will result in the cluster being upgraded with a
manually set parameter group not managed by terraform.

If you manually upgraded and the cluster is now on version 11.13, to continue
using the `cumulus-rds-tf` module *once upgraded* update following module
configuration values if set, or allow their defaults to be utilized:

```terraform
parameter_group_family = "aurora-postgresql11"
engine_version = 11.13
```

When you apply this update, the original PostgreSQL v10 parameter group will be
removed, and recreated using PG11 defaults/configured terraform values and
update the database cluster to use the new configuration.

### Added

- **CUMULUS-3193**
  - Add a Python version file
- **CUMULUS-3121**
  - Added a map of variables in terraform for custom configuration of cloudwatch_log_groups' retention periods.
    Please refer to the [Cloudwatch-Retention] (https://nasa.github.io/cumulus/docs/configuration/cloudwatch-retention)
    section of the Cumulus documentation in order for more detailed information and an example into how to do this.
- **CUMULUS-3071**
  - Added 'PATCH' granules endpoint as an exact duplicate of the existing `PUT`
    endpoint.    In future releases the `PUT` endpoint will be replaced with valid PUT logic
    behavior (complete overwrite) in a future release.   **The existing PUT
    implementation is deprecated** and users should move all existing usage of
    `PUT` to `PATCH` before upgrading to a release with `CUMULUS-3072`.

### Fixed

- **CUMULUS-3033**
  - Fixed `granuleEsQuery` to properly terminate if `body.hit.total.value` is 0.

- The `getLambdaAliases` function has been removed from the `@cumulus/integration-tests` package
- The `getLambdaVersions` function has been removed from the `@cumulus/integration-tests` package
- **CUMULUS-3117**
  - Update `@cumulus/es-client/indexer.js` to properly handle framework write
    constraints for queued granules.    Queued writes will now be properly
    dropped from elasticsearch writes along with the primary datastore(s) when
    write constraints apply
- **CUMULUS-3134**
  - Get tests working on M1 Macs
- **CUMULUS-3148**:
  - Updates cumulus-rds-tf to use defaults for PostgreSQL 11.13
  - Update IngestGranuleSuccessSpec as test was dependant on file ordering and
    PostgreSQL 11 upgrade exposed dependency on database results in the API return
  - Update unit test container to utilize PostgreSQL 11.13 container
- **CUMULUS-3149**
  - Updates the api `/granules/bulkDelete` endpoint to take the
    following configuration keys for the bulkDelete:
    - concurrency - Number of concurrent bulk deletions to process at a time.
            Defaults to 10, increasing this value may improve throughput at the cost
            of additional database/CMR/etc load.
    - maxDbConnections - Defaults to `concurrency`, and generally should not be
        changed unless troubleshooting performance concerns.
  - Updates all bulk api endpoints to add knexDebug boolean query parameter to
    allow for debugging of database connection issues in the future.  Defaults
    to false.
  - Fixed logic defect in bulk deletion logic where an information query was
    nested in a transaction call, resulting in transactions holding knex
    connection pool connections in a blocking way that would not resolve,
    resulting in deletion failures.
- **CUMULUS-3142**
  - Fix issue from CUMULUS-3070 where undefined values for status results in
    unexpected insertion failure on PATCH.
- **CUMULUS-3181**
  - Fixed `sqsMessageRemover` lambda to correctly retrieve ENABLED sqs rules.

- **CUMULUS-3189**
  - Upgraded `cumulus-process` and `cumulus-message-adapter-python` versions to
    support pip 23.0
- **CUMULUS-3196**
  - Moved `createServer` initialization outside the `s3-credentials-endpoint` lambda
    handler to reduce file descriptor usage
- README shell snippets better support copying
- **CUMULUS-3111**
  - Fix issue where if granule update dropped due to write constraints for writeGranuleFromMessage, still possible for granule files to be written
  - Fix issue where if granule update is limited to status and timestamp values due to write constraints for writeGranuleFromMessage, Dynamo or ES granules could be out of sync with PG

### Breaking Changes

- **CUMULUS-3072**
  - Removed original PUT granule endpoint logic (in favor of utilizing new PATCH
    endpoint introduced in CUMULUS-3071)
  - Updated PUT granule endpoint to expected RESTful behavior:
    - PUT will now overwrite all non-provided fields as either non-defined or
      defaults, removing existing related database records (e.g. files,
      granule-execution linkages ) as appropriate.
    - PUT will continue to overwrite fields that are provided in the payload,
      excepting collectionId and granuleId which cannot be modified.
    - PUT will create a new granule record if one does not already exist
    - Like PATCH, the execution field is additive only - executions, once
      associated with a granule record cannot be unassociated via the granule
      endpoint.
  - /granule PUT and PATCH endpoints now require a header with values `{
    version: 2 }`
  - PUT endpoint will now only support /:collectionId/:granuleId formatted
    queries
  - `@cumulus/api-client.replaceGranule now utilizes body.collectionId to
    utilize the correct API PUT endpoint
  - Cumulus API version updated to `2`

### Changed

- **Snyk Security**
  - Upgraded jsonwebtoken from 8.5.1 to 9.0.0
  - CUMULUS-3160: Upgrade knex from 0.95.15 to 2.4.1
  - Upgraded got from 11.8.3 to ^11.8.5
- **Dependabot Security**
  - Upgraded the python package dependencies of the example lambdas
- **CUMULUS-3043**
  - Organize & link Getting Started public docs for better user guidance
  - Update Getting Started sections with current content
- **CUMULUS-3046**
  - Update 'Deployment' public docs
  - Apply grammar, link fixes, and continuity/taxonomy standards
- **CUMULUS-3071**
  - Updated `@cumulus/api-client` packages to use `PATCH` protocol for existing
    granule `PUT` calls, this change should not require user updates for
    `api-client` users.
    - `@cumulus/api-client/granules.updateGranule`
    - `@cumulus/api-client/granules.moveGranule`
    - `@cumulus/api-client/granules.updateGranule`
    - `@cumulus/api-client/granules.reingestGranule`
    - `@cumulus/api-client/granules.removeFromCMR`
    - `@cumulus/api-client/granules.applyWorkflow`
- **CUMULUS-3097**
  - Changed `@cumulus/cmr-client` package's token from Echo-Token to Earthdata Login (EDL) token in updateToken method
  - Updated CMR header and token tests to reflect the Earthdata Login changes
- **CUMULUS-3144**
  - Increased the memory of API lambda to 1280MB
- **CUMULUS-3140**
  - Update release note to include cumulus-api release
- **CUMULUS-3193**
  - Update eslint config to better support typing
- Improve linting of TS files

### Removed

- **CUMULUS-2798**
  - Removed AsyncOperations model

### Removed

- **CUMULUS-3009**
  - Removed Dynamo PDRs table

## [v14.0.0] 2022-12-08

### Breaking Changes

- **CUMULUS-2915**
  - API endpoint GET `/executions/status/${executionArn}` returns `presignedS3Url` and `data`
  - The user (dashboard) must read the `s3SignedURL` and `data` from the return
- **CUMULUS-3070/3074**
  - Updated granule PUT/POST endpoints to no longer respect message write
    constraints.  Functionally this means that:
    - Granules with older createdAt values will replace newer ones, instead of
        ignoring the write request
    - Granules that attempt to set a non-complete state (e.g. 'queued' and
        'running') will now ignore execution state/state change and always write
    - Granules being set to non-complete state will update all values passed in,
      instead of being restricted to `['createdAt', 'updatedAt', 'timestamp',
      'status', 'execution']`

### Added

- **CUMULUS-3070**
  - Remove granules dynamoDb model logic that sets default publish value on record
    validation
  - Update API granule write logic to not set default publish value on record
    updates to avoid overwrite (PATCH behavior)
  - Update API granule write logic to publish to false on record
    creation if not specified
  - Update message granule write logic to set default publish value on record
    creation update.
  - Update granule write logic to set published to default value of `false` if
    `null` is explicitly set with intention to delete the value.
  - Removed dataType/version from api granule schema
  - Added `@cumulus/api/endpoints/granules` unit to cover duration overwrite
    logic for PUT/PATCH endpoint.
- **CUMULUS-3098**
  - Added task configuration setting named `failTaskWhenFileBackupFail` to the
    `lzards-backup` task. This setting is `false` by default, but when set to
    `true`, task will fail if one of the file backup request fails.

### Changed

- Updated CI deploy process to utilize the distribution module in the published zip file which
    will be run against for the integration tests
- **CUMULUS-2915**
  - Updated API endpoint GET `/executions/status/${executionArn}` to return the
    presigned s3 URL in addition to execution status data
- **CUMULUS-3045**
  - Update GitHub FAQs:
    - Add new and refreshed content for previous sections
    - Add new dedicated Workflows section
- **CUMULUS-3070**
  - Updated API granule write logic to no longer require createdAt value in
    dynamo/API granule validation.   Write-time createdAt defaults will be set in the case
    of new API granule writes without the value set, and createdAt will be
    overwritten if it already exists.
  - Refactored granule write logic to allow PATCH behavior on API granule update
    such that existing createdAt values will be retained in case of overwrite
    across all API granule writes.
  - Updated granule write code to validate written createdAt is synced between
    datastores in cases where granule.createdAt is not provided for a new
    granule.
  - Updated @cumulus/db/translate/granules.translateApiGranuleToPostgresGranuleWithoutNilsRemoved to validate incoming values to ensure values that can't be set to null are not
  - Updated @cumulus/db/translate/granules.translateApiGranuleToPostgresGranuleWithoutNilsRemoved to handle null values in incoming ApiGranule
  - Updated @cumulus/db/types/granules.PostgresGranule typings to allow for null values
  - Added ApiGranuleRecord to @cumulus/api/granule type to represent a written/retrieved from datastore API granule record.
  - Update API/Message write logic to handle nulls as deletion in granule PUT/message write logic
- **CUMULUS-3075**
  - Changed the API endpoint return value for a granule with no files. When a granule has no files, the return value beforehand for
    the translatePostgresGranuletoApiGranule, the function which does the translation of a Postgres granule to an API granule, was
    undefined, now changed to an empty array.
  - Existing behavior which relied on the pre-disposed undefined value was changed to instead accept the empty array.
  - Standardized tests in order to expect an empty array for a granule with no files files' object instead of undefined.
- **CUMULUS-3077**
  - Updated `lambdas/data-migration2` granule and files migration to have a `removeExcessFiles` function like in write-granules that will remove file records no longer associated with a granule being migrated
- **CUMULUS-3080**
  - Changed the retention period in days from 14 to 30 for cloudwatch logs for NIST-5 compliance
- **CUMULUS-3100**
  - Updated `POST` granules endpoint to check if granuleId exists across all collections rather than a single collection.
  - Updated `PUT` granules endpoint to check if granuleId exists across a different collection and throw conflict error if so.
  - Updated logic for writing granules from a message to check if granuleId exists across a different collection and throw conflict error if so.

### Fixed

- **CUMULUS-3070**
  - Fixed inaccurate typings for PostgresGranule in @cumulus/db/types/granule
  - Fixed inaccurate typings for @cumulus/api/granules.ApiGranule and updated to
    allow null
- **CUMULUS-3104**
  - Fixed TS compilation error on aws-client package caused by @aws-sdk/client-s3 3.202.0 upgrade
- **CUMULUS-3116**
  - Reverted the default ElasticSearch sorting behavior to the pre-13.3.0 configuration
  - Results from ElasticSearch are sorted by default by the `timestamp` field. This means that the order
  is not guaranteed if two or more records have identical timestamps as there is no secondary sort/tie-breaker.

## [v13.4.0] 2022-10-31

### Notable changes

- **CUMULUS-3104**
  - Published new tag [`43` of `cumuluss/async-operation` to Docker Hub](https://hub.docker.com/layers/cumuluss/async-operation/43/images/sha256-5f989c7d45db3dde87c88c553182d1e4e250a1e09af691a84ff6aa683088b948?context=explore) which was built with node:14.19.3-buster.

### Added

- **CUMULUS-2998**
  - Added Memory Size and Timeout terraform variable configuration for the following Cumulus tasks:
    - fake_processing_task_timeout and fake_processing_task_memory_size
    - files_to_granules_task_timeout and files_to_granule_task_memory_size
    - hello_world_task_timeout and hello_world_task_memory_size
    - sf_sqs_report_task_timeout and sf_sqs_report_task_memory_size
- **CUMULUS-2986**
  - Adds Terraform memory_size configurations to lambda functions with customizable timeouts enabled (the minimum default size has also been raised from 256 MB to 512 MB)
    allowed properties include:
      - add_missing_file_checksums_task_memory_size
      - discover_granules_task_memory_size
      - discover_pdrs_task_memory_size
      - hyrax_metadata_updates_task_memory_size
      - lzards_backup_task_memory_size
      - move_granules_task_memory_size
      - parse_pdr_task_memory_size
      - pdr_status_check_task_memory_size
      - post_to_cmr_task_memory_size
      - queue_granules_task_memory_size
      - queue_pdrs_task_memory_size
      - queue_workflow_task_memory_size
      - sync_granule_task_memory_size
      - update_cmr_access_constraints_task_memory_size
      - update_granules_cmr_task_memory_size
  - Initializes the lambda_memory_size(s) variable in the Terraform variable list
  - Adds Terraform timeout variable for add_missing_file_checksums_task
- **CUMULUS-2631**
  - Added 'Bearer token' support to s3credentials endpoint
- **CUMULUS-2787**
  - Added `lzards-api-client` package to Cumulus with `submitQueryToLzards` method
- **CUMULUS-2944**
  - Added configuration to increase the limit for body-parser's JSON and URL encoded parsers to allow for larger input payloads

### Changed


- Updated `example/cumulus-tf/variables.tf` to have `cmr_oauth_provider` default to `launchpad`
- **CUMULUS-3024**
  - Update PUT /granules endpoint to operate consistently across datastores
    (PostgreSQL, ElasticSearch, DynamoDB). Previously it was possible, given a
    partial Granule payload to have different data in Dynamo/ElasticSearch and PostgreSQL
  - Given a partial Granule object, the /granules update endpoint now operates
    with behavior more consistent with a PATCH operation where fields not provided
    in the payload will not be updated in the datastores.
  - Granule translation (db/src/granules.ts) now supports removing null/undefined fields when converting from API to Postgres
    granule formats.
  - Update granule write logic: if a `null` files key is provided in an update payload (e.g. `files: null`),
    an error will be thrown. `null` files were not previously supported and would throw potentially unclear errors. This makes the error clearer and more explicit.
  - Update granule write logic: If an empty array is provided for the `files` key, all files will be removed in all datastores
- **CUMULUS-2787**
  - Updated `lzards-backup-task` to send Cumulus provider and granule createdAt values as metadata in LZARDS backup request to support querying LZARDS for reconciliation reports
- **CUMULUS-2913**
  - Changed `process-dead-letter-archive` lambda to put messages from S3 dead
    letter archive that fail to process to new S3 location.
- **CUMULUS-2974**
  - The `DELETE /granules/<granuleId>` endpoint now includes additional details about granule
    deletion, including collection, deleted granule ID, deleted files, and deletion time.
- **CUMULUS-3027**
  - Pinned typescript to ~4.7.x to address typing incompatibility issues
    discussed in https://github.com/knex/knex/pull/5279
  - Update generate-ts-build-cache script to always install root project dependencies
- **CUMULUS-3104**
  - Updated Dockerfile of async operation docker image to build from node:14.19.3-buster
  - Sets default async_operation_image version to 43.
  - Upgraded saml2-js 4.0.0, rewire to 6.0.0 to address security vulnerabilities
  - Fixed TS compilation error caused by @aws-sdk/client-s3 3.190->3.193 upgrade

## [v13.3.2] 2022-10-10 [BACKPORT]

**Please note** changes in 13.3.2 may not yet be released in future versions, as
this is a backport and patch release on the 13.3.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Fixed

- **CUMULUS-2557**
  - Updated `@cumulus/aws-client/S3/moveObject` to handle zero byte files (0 byte files).
- **CUMULUS-2971**
  - Updated `@cumulus/aws-client/S3ObjectStore` class to take string query parameters and
    its methods `signGetObject` and `signHeadObject` to take parameter presignOptions
- **CUMULUS-3021**
  - Updated `@cumulus/api-client/collections` and `@cumulus/integration-tests/api` to encode
    collection version in the URI path
- **CUMULUS-3024**
  - Update PUT /granules endpoint to operate consistently across datastores
    (PostgreSQL, ElasticSearch, DynamoDB). Previously it was possible, given a
    partial Granule payload to have different data in Dynamo/ElasticSearch and PostgreSQL
  - Given a partial Granule object, the /granules update endpoint now operates
    with behavior more consistent with a PATCH operation where fields not provided
    in the payload will not be updated in the datastores.
  - Granule translation (db/src/granules.ts) now supports removing null/undefined fields when converting from API to Postgres
    granule formats.
  - Update granule write logic: if a `null` files key is provided in an update payload (e.g. `files: null`),
    an error will be thrown. `null` files were not previously supported and would throw potentially unclear errors. This makes the error clearer and more explicit.
  - Update granule write logic: If an empty array is provided for the `files` key, all files will be removed in all datastores

## [v13.3.0] 2022-8-19

### Notable Changes

- **CUMULUS-2930**
  - The `GET /granules` endpoint has a new optional query parameter:
    `searchContext`, which is used to resume listing within the same search
    context. It is provided in every response from the endpoint as
    `meta.searchContext`. The searchContext value must be submitted with every
    consequent API call, and must be fetched from each new response to maintain
    the context.
  - Use of the `searchContext` query string parameter allows listing past 10,000 results.
  - Note that using the `from` query param in a request will cause the `searchContext` to
    be ignored and also make the query subject to the 10,000 results cap again.
  - Updated `GET /granules` endpoint to leverage ElasticSearch search-after API.
    The endpoint will only use search-after when the `searchContext` parameter
    is provided in a request.

## [v13.2.1] 2022-8-10 [BACKPORT]

### Notable changes

- **CUMULUS-3019**
  - Fix file write logic to delete files by `granule_cumulus_id` instead of
    `cumulus_id`. Previous logic removed files by matching `file.cumulus_id`
    to `granule.cumulus_id`.

## [v13.2.0] 2022-8-04

### Changed

- **CUMULUS-2940**
  - Updated bulk operation lambda to utilize system wide rds_connection_timing
    configuration parameters from the main `cumulus` module
- **CUMULUS-2980**
  - Updated `ingestPdrWithNodeNameSpec.js` to use `deleteProvidersAndAllDependenciesByHost` function.
  - Removed `deleteProvidersByHost`function.
- **CUMULUS-2954**
  - Updated Backup LZARDS task to run as a single task in a step function workflow.
  - Updated task to allow user to provide `collectionId` in workflow input and
    updated task to use said `collectionId` to look up the corresponding collection record in RDS.

## [v13.1.0] 2022-7-22

### MIGRATION notes

- The changes introduced in CUMULUS-2962 will re-introduce a
  `files_granules_cumulus_id_index` on the `files` table in the RDS database.
  This index will be automatically created as part of the bootstrap lambda
  function *on deployment* of the `data-persistence` module.

  *In cases where the index is already applied, this update will have no effect*.

  **Please Note**: In some cases where ingest is occurring at high volume levels and/or the
  files table has > 150M file records, the migration may
  fail on deployment due to timing required to both acquire the table state needed for the
  migration and time to create the index given the resources available.

  For reference a rx.5 large Aurora/RDS database
  with *no activity* took roughly 6 minutes to create the index for a file table with 300M records and no active ingest, however timed out when the same migration was attempted
  in production with possible activity on the table.

  If you believe you are subject to the above consideration, you may opt to
  manually create the `files` table index *prior* to deploying this version of
  Core with the following procedure:

  -----

  - Verify you do not have the index:

  ```text
  select * from pg_indexes where tablename = 'files';

   schemaname | tablename |        indexname        | tablespace |                                       indexdef
  ------------+-----------+-------------------------+------------+---------------------------------------------------------------------------------------
   public     | files     | files_pkey              |            | CREATE UNIQUE INDEX files_pkey ON public.files USING btree (cumulus_id)
   public     | files     | files_bucket_key_unique |            | CREATE UNIQUE INDEX files_bucket_key_unique ON public.files USING btree (bucket, key)
  ```

  In this instance you should not see an `indexname` row with
  `files_granules_cumulus_id_index` as the value.     If you *do*, you should be
  clear to proceed with the installation.
  - Quiesce ingest

  Stop all ingest operations in Cumulus Core according to your operational
  procedures.    You should validate that it appears there are no active queries that
  appear to be inserting granules/files into the database as a secondary method
  of evaluating the database system state:

  ```text
  select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
  ```

  If query rows are returned with a `query` value that involves the files table,
  make sure ingest is halted and no other granule-update activity is running on
  the system.

  Note: In rare instances if there are hung queries that are unable to resolve, it may be necessary to
  manually use psql [Server Signaling
  Functions](https://www.postgresql.org/docs/10/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)
  `pg_cancel_backend` and/or
  `pg_terminate_backend` if the migration will not complete in the next step.

  - Create the Index

  Run the following query to create the index.    Depending on the situation
  this may take many minutes to complete, and you will note your CPU load and
  disk I/O rates increase on your cluster:

  ```text
  CREATE INDEX files_granule_cumulus_id_index ON files (granule_cumulus_id);
  ```

  You should see a response like:

  ```text
  CREATE INDEX
  ```

  and can verify the index `files_granule_cumulus_id_index` was created:

  ```text
  => select * from pg_indexes where tablename = 'files';
  schemaname | tablename |           indexname            | tablespace |                                           indexdef
   ------------+-----------+--------------------------------+------------+----------------------------------------------------------------------------------------------
   public     | files     | files_pkey                     |            | CREATE UNIQUE INDEX files_pkey ON public.files USING btree (cumulus_id)
   public     | files     | files_bucket_key_unique        |            | CREATE UNIQUE INDEX files_bucket_key_unique ON public.files USING btree (bucket, key)
   public     | files     | files_granule_cumulus_id_index |            | CREATE INDEX files_granule_cumulus_id_index ON public.files USING btree (granule_cumulus_id)
  (3 rows)
  ```

  - Once this is complete, you may deploy this version of Cumulus as you
    normally would.
  **If you are unable to stop ingest for the above procedure** *and* cannot
  migrate with deployment, you may be able to manually create the index while
  writes are ongoing using postgres's `CONCURRENTLY` option for `CREATE INDEX`.
  This can have significant impacts on CPU/write IO, particularly if you are
  already using a significant amount of your cluster resources, and may result
  in failed writes or an unexpected index/database state.

  PostgreSQL's
  [documentation](https://www.postgresql.org/docs/10/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
  provides more information on this option.   Please be aware it is
  **unsupported** by Cumulus at this time, so community members that opt to go
  this route should proceed with caution.

  -----

### Notable changes

- **CUMULUS-2962**
  - Re-added database structural migration to `files` table to add an index on `granule_cumulus_id`
- **CUMULUS-2929**
  - Updated `move-granule` task to check the optional collection configuration parameter
    `meta.granuleMetadataFileExtension` to determine the granule metadata file.
    If none is specified, the granule CMR metadata or ISO metadata file is used.

### Changed

- Updated Moment.js package to 2.29.4 to address security vulnerability
- **CUMULUS-2967**
  - Added fix example/spec/helpers/Provider that doesn't fail deletion 404 in
    case of deletion race conditions
### Fixed

- **CUMULUS-2995**
  - Updated Lerna package to 5.1.8 to address security vulnerability

- **CUMULUS-2863**
  - Fixed `@cumulus/api` `validateAndUpdateSqsRule` method to allow 0 retries and 0 visibilityTimeout
    in rule's meta.

- **CUMULUS-2959**
  - Fixed `@cumulus/api` `granules` module to convert numeric productVolume to string
    when an old granule record is retrieved from DynamoDB
- Fixed the following links on Cumulus docs' [Getting Started](https://nasa.github.io/cumulus/docs/getting-started) page:
    * Cumulus Deployment
    * Terraform Best Practices
    * Integrator Common Use Cases
- Also corrected the _How to Deploy Cumulus_ link in the [Glossary](https://nasa.github.io/cumulus/docs/glossary)


## [v13.0.1] 2022-7-12

- **CUMULUS-2995**
  - Updated Moment.js package to 2.29.4 to address security vulnerability

## [v13.0.0] 2022-06-13

### MIGRATION NOTES

- The changes introduced in CUMULUS-2955 should result in removal of
  `files_granule_cumulus_id_index` from the `files` table (added in the v11.1.1
  release).  The success of this operation is dependent on system ingest load.

  In rare cases where data-persistence deployment fails because the
  `postgres-db-migration` times out, it may be required to manually remove the
  index and then redeploy:

  ```text
  DROP INDEX IF EXISTS files_granule_cumulus_id_index;
  ```

### Breaking Changes

- **CUMULUS-2931**

  - Updates CustomBootstrap lambda to default to failing if attempting to remove
    a pre-existing `cumulus-alias` index that would collide with the required
    `cumulus-alias` *alias*.   A configuration parameter
    `elasticsearch_remove_index_alias_conflict`  on the `cumulus` and
    `archive` modules has been added to enable the original behavior that would
    remove the invalid index (and all it's data).
  - Updates `@cumulus/es-client.bootstrapElasticSearch` signature to be
    parameterized and accommodate a new parameter `removeAliasConflict` which
    allows/disallows the deletion of a conflicting `cumulus-alias` index

### Notable changes

- **CUMULUS-2929**
  - Updated `move-granule` task to check the optional collection configuration parameter
    `meta.granuleMetadataFileExtension` to determine the granule metadata file.
    If none is specified, the granule CMR metadata or ISO metadata file is used.

### Added

- **CUMULUS-2929**
  - Added optional collection configuration `meta.granuleMetadataFileExtension` to specify CMR metadata
    file extension for tasks that utilize metadata file lookups

- **CUMULUS-2939**
  - Added `@cumulus/api/lambdas/start-async-operation` to start an async operation

- **CUMULUS-2953**
  - Added `skipMetadataCheck` flag to config for Hyrax metadata updates task.
  - If this config flag is set to `true`, and a granule has no CMR file, the task will simply return the input values.

- **CUMULUS-2966**
  - Added extractPath operation and support of nested string replacement to `url_path` in the collection configuration

### Changed

- **CUMULUS-2965**
  - Update `cumulus-rds-tf` module to ignore `engine_version` lifecycle changes
- **CUMULUS-2967**
  - Added fix example/spec/helpers/Provider that doesn't fail deletion 404 in
    case of deletion race conditions
- **CUMULUS-2955**
  - Updates `20220126172008_files_granule_id_index` to *not* create an index on
    `granule_cumulus_id` on the files table.
  - Adds `20220609024044_remove_files_granule_id_index` migration to revert
    changes from `20220126172008_files_granule_id_index` on any deployed stacks
    that might have the index to ensure consistency in deployed stacks

- **CUMULUS-2923**
  - Changed public key setup for SFTP local testing.
- **CUMULUS-2939**
  - Updated `@cumulus/api` `granules/bulk*`, `elasticsearch/index-from-database` and
    `POST reconciliationReports` endpoints to invoke StartAsyncOperation lambda

### Fixed

- **CUMULUS-2863**
  - Fixed `@cumulus/api` `validateAndUpdateSqsRule` method to allow 0 retries
    and 0 visibilityTimeout in rule's meta.
- **CUMULUS-2961**
  - Fixed `data-migration2` granule migration logic to allow for DynamoDb granules that have a null/empty string value for `execution`.   The migration will now migrate them without a linked execution.
  - Fixed `@cumulus/api` `validateAndUpdateSqsRule` method to allow 0 retries and 0 visibilityTimeout
    in rule's meta.

- **CUMULUS-2959**
  - Fixed `@cumulus/api` `granules` module to convert numeric productVolume to string
    when an old granule record is retrieved from DynamoDB.

## [v12.0.3] 2022-10-03 [BACKPORT]

**Please note** changes in 12.0.3 may not yet be released in future versions, as
this is a backport and patch release on the 12.0.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Fixed

- **CUMULUS-3024**
  - Update PUT /granules endpoint to operate consistently across datastores
    (PostgreSQL, ElasticSearch, DynamoDB). Previously it was possible, given a
    partial Granule payload to have different data in Dynamo/ElasticSearch and PostgreSQL
  - Given a partial Granule object, the /granules update endpoint now operates
    with behavior more consistent with a PATCH operation where fields not provided
    in the payload will not be updated in the datastores.
  - Granule translation (db/src/granules.ts) now supports removing null/undefined fields when converting from API to Postgres
    granule formats.
  - Update granule write logic: if a `null` files key is provided in an update payload (e.g. `files: null`),
    an error will be thrown. `null` files were not previously supported and would throw potentially unclear errors. This makes the error clearer and more explicit.
  - Update granule write logic: If an empty array is provided for the `files` key, all files will be removed in all datastores
- **CUMULUS-2971**
  - Updated `@cumulus/aws-client/S3ObjectStore` class to take string query parameters and
    its methods `signGetObject` and `signHeadObject` to take parameter presignOptions
- **CUMULUS-2557**
  - Updated `@cumulus/aws-client/S3/moveObject` to handle zero byte files (0 byte files).
- **CUMULUS-3021**
  - Updated `@cumulus/api-client/collections` and `@cumulus/integration-tests/api` to encode
    collection version in the URI path

## [v12.0.2] 2022-08-10 [BACKPORT]

**Please note** changes in 12.0.2 may not yet be released in future versions, as
this is a backport and patch release on the 12.0.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Notable Changes

- **CUMULUS-3019**
  - Fix file write logic to delete files by `granule_cumulus_id` instead of
      `cumulus_id`. Previous logic removed files by matching `file.cumulus_id`
      to `granule.cumulus_id`.

## [v12.0.1] 2022-07-18

- **CUMULUS-2995**
  - Updated Moment.js package to 2.29.4 to address security vulnerability

## [v12.0.0] 2022-05-20

### Breaking Changes

- **CUMULUS-2903**

  - The minimum supported version for all published Cumulus Core npm packages is now Node 14.19.1
  - Tasks using the `cumuluss/cumulus-ecs-task` Docker image must be updated to
    `cumuluss/cumulus-ecs-task:1.8.0`. This can be done by updating the `image`
    property of any tasks defined using the `cumulus_ecs_service` Terraform
    module.

### Changed

- **CUMULUS-2932**

  - Updates `SyncGranule` task to include `disableOrDefaultAcl` function that uses
    the configuration ACL parameter to set ACL to private by default or disable ACL.
  - Updates `@cumulus/sync-granule` `download()` function to take in ACL parameter
  - Updates `@cumulus/ingest` `proceed()` function to take in ACL parameter
  - Updates `@cumulus/ingest` `addLock()` function to take in an optional ACL parameter
  - Updates `SyncGranule` example worfklow config
    `example/cumulus-tf/sync_granule_workflow.asl.json` to include `ACL`
    parameter.

## [v11.1.8] 2022-11-07 [BACKPORT]

**Please note** changes in 11.1.7 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Breaking Changes

- **CUMULUS-2903**
  - The minimum supported version for all published Cumulus Core npm packages is now Node 14.19.1
  - Tasks using the `cumuluss/cumulus-ecs-task` Docker image must be updated to
    `cumuluss/cumulus-ecs-task:1.8.0`. This can be done by updating the `image`
    property of any tasks defined using the `cumulus_ecs_service` Terraform
    module.

### Notable changes

- Published new tag [`43` of `cumuluss/async-operation` to Docker Hub](https://hub.docker.com/layers/cumuluss/async-operation/43/images/sha256-5f989c7d45db3dde87c88c553182d1e4e250a1e09af691a84ff6aa683088b948?context=explore) which was built with node:14.19.3-buster.

### Changed

- **CUMULUS-3104**
  - Updated Dockerfile of async operation docker image to build from node:14.19.3-buster
  - Sets default async_operation_image version to 43.
  - Upgraded saml2-js 4.0.0, rewire to 6.0.0 to address security vulnerabilities
  - Fixed TS compilation error on aws-client package caused by @aws-sdk/client-s3 3.202.0 upgrade

- **CUMULUS-3080**
  - Changed the retention period in days from 14 to 30 for cloudwatch logs for NIST-5 compliance

## [v11.1.7] 2022-10-05 [BACKPORT]

**Please note** changes in 11.1.7 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Fixed

- **CUMULUS-3024**
  - Update PUT /granules endpoint to operate consistently across datastores
    (PostgreSQL, ElasticSearch, DynamoDB). Previously it was possible, given a
    partial Granule payload to have different data in Dynamo/ElasticSearch and PostgreSQL
  - Given a partial Granule object, the /granules update endpoint now operates
    with behavior more consistent with a PATCH operation where fields not provided
    in the payload will not be updated in the datastores.
  - Granule translation (db/src/granules.ts) now supports removing null/undefined fields when converting from API to Postgres
    granule formats.
  - Update granule write logic: if a `null` files key is provided in an update payload (e.g. `files: null`),
    an error will be thrown. `null` files were not previously supported and would throw potentially unclear errors. This makes the error clearer and more explicit.
  - Update granule write logic: If an empty array is provided for the `files` key, all files will be removed in all datastores
- **CUMULUS-2971**
  - Updated `@cumulus/aws-client/S3ObjectStore` class to take string query parameters and
    its methods `signGetObject` and `signHeadObject` to take parameter presignOptions
- **CUMULUS-2557**
  - Updated `@cumulus/aws-client/S3/moveObject` to handle zero byte files (0 byte files).
- **CUMULUS-3021**
  - Updated `@cumulus/api-client/collections` and `@cumulus/integration-tests/api` to encode
    collection version in the URI path
- **CUMULUS-3027**
  - Pinned typescript to ~4.7.x to address typing incompatibility issues
    discussed in https://github.com/knex/knex/pull/5279
  - Update generate-ts-build-cache script to always install root project dependencies

## [v11.1.5] 2022-08-10 [BACKPORT]

**Please note** changes in 11.1.5 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Notable changes

- **CUMULUS-3019**
  - Fix file write logic to delete files by `granule_cumulus_id` instead of
      `cumulus_id`. Previous logic removed files by matching `file.cumulus_id`
      to `granule.cumulus_id`.

## [v11.1.4] 2022-07-18

**Please note** changes in 11.1.4 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### MIGRATION notes


- The changes introduced in CUMULUS-2962 will re-introduce a
  `files_granules_cumulus_id_index` on the `files` table in the RDS database.
  This index will be automatically created as part of the bootstrap lambda
  function *on deployment* of the `data-persistence` module.

  *In cases where the index is already applied, this update will have no effect*.

  **Please Note**: In some cases where ingest is occurring at high volume levels and/or the
  files table has > 150M file records, the migration may
  fail on deployment due to timing required to both acquire the table state needed for the
  migration and time to create the index given the resources available.

  For reference a rx.5 large Aurora/RDS database
  with *no activity* took roughly 6 minutes to create the index for a file table with 300M records and no active ingest, however timed out when the same migration was attempted
  in production with possible activity on the table.

  If you believe you are subject to the above consideration, you may opt to
  manually create the `files` table index *prior* to deploying this version of
  Core with the following procedure:

  -----

  - Verify you do not have the index:

  ```text
  select * from pg_indexes where tablename = 'files';

   schemaname | tablename |        indexname        | tablespace |                                       indexdef
  ------------+-----------+-------------------------+------------+---------------------------------------------------------------------------------------
   public     | files     | files_pkey              |            | CREATE UNIQUE INDEX files_pkey ON public.files USING btree (cumulus_id)
   public     | files     | files_bucket_key_unique |            | CREATE UNIQUE INDEX files_bucket_key_unique ON public.files USING btree (bucket, key)
  ```

  In this instance you should not see an `indexname` row with
  `files_granules_cumulus_id_index` as the value.     If you *do*, you should be
  clear to proceed with the installation.
  - Quiesce ingest

  Stop all ingest operations in Cumulus Core according to your operational
  procedures.    You should validate that it appears there are no active queries that
  appear to be inserting granules/files into the database as a secondary method
  of evaluating the database system state:

  ```text
  select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
  ```

  If query rows are returned with a `query` value that involves the files table,
  make sure ingest is halted and no other granule-update activity is running on
  the system.

  Note: In rare instances if there are hung queries that are unable to resolve, it may be necessary to
  manually use psql [Server Signaling
  Functions](https://www.postgresql.org/docs/10/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)
  `pg_cancel_backend` and/or
  `pg_terminate_backend` if the migration will not complete in the next step.

  - Create the Index

  Run the following query to create the index.    Depending on the situation
  this may take many minutes to complete, and you will note your CPU load and
  disk I/O rates increase on your cluster:

  ```text
  CREATE INDEX files_granule_cumulus_id_index ON files (granule_cumulus_id);
  ```

  You should see a response like:

  ```text
  CREATE INDEX
  ```

  and can verify the index `files_granule_cumulus_id_index` was created:

  ```text
  => select * from pg_indexes where tablename = 'files';
  schemaname | tablename |           indexname            | tablespace |                                           indexdef
   ------------+-----------+--------------------------------+------------+----------------------------------------------------------------------------------------------
   public     | files     | files_pkey                     |            | CREATE UNIQUE INDEX files_pkey ON public.files USING btree (cumulus_id)
   public     | files     | files_bucket_key_unique        |            | CREATE UNIQUE INDEX files_bucket_key_unique ON public.files USING btree (bucket, key)
   public     | files     | files_granule_cumulus_id_index |            | CREATE INDEX files_granule_cumulus_id_index ON public.files USING btree (granule_cumulus_id)
  (3 rows)
  ```

  - Once this is complete, you may deploy this version of Cumulus as you
    normally would.
  **If you are unable to stop ingest for the above procedure** *and* cannot
  migrate with deployment, you may be able to manually create the index while
  writes are ongoing using postgres's `CONCURRENTLY` option for `CREATE INDEX`.
  This can have significant impacts on CPU/write IO, particularly if you are
  already using a significant amount of your cluster resources, and may result
  in failed writes or an unexpected index/database state.

  PostgreSQL's
  [documentation](https://www.postgresql.org/docs/10/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
  provides more information on this option.   Please be aware it is
  **unsupported** by Cumulus at this time, so community members that opt to go
  this route should proceed with caution.

  -----

### Changed

- Updated Moment.js package to 2.29.4 to address security vulnerability

## [v11.1.3] 2022-06-24

**Please note** changes in 11.1.3 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Notable changes

- **CUMULUS-2929**
  - Updated `move-granule` task to check the optional collection configuration parameter
    `meta.granuleMetadataFileExtension` to determine the granule metadata file.
    If none is specified, the granule CMR metadata or ISO metadata file is used.

### Added

- **CUMULUS-2929**
  - Added optional collection configuration `meta.granuleMetadataFileExtension` to specify CMR metadata
    file extension for tasks that utilize metadata file lookups
- **CUMULUS-2966**
  - Added extractPath operation and support of nested string replacement to `url_path` in the collection configuration
### Fixed

- **CUMULUS-2863**
  - Fixed `@cumulus/api` `validateAndUpdateSqsRule` method to allow 0 retries
    and 0 visibilityTimeout in rule's meta.
- **CUMULUS-2959**
  - Fixed `@cumulus/api` `granules` module to convert numeric productVolume to string
    when an old granule record is retrieved from DynamoDB.
- **CUMULUS-2961**
  - Fixed `data-migration2` granule migration logic to allow for DynamoDb granules that have a null/empty string value for `execution`.   The migration will now migrate them without a linked execution.

## [v11.1.2] 2022-06-13

**Please note** changes in 11.1.2 may not yet be released in future versions, as
this is a backport and patch release on the 11.1.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### MIGRATION NOTES

- The changes introduced in CUMULUS-2955 should result in removal of
  `files_granule_cumulus_id_index` from the `files` table (added in the v11.1.1
  release).  The success of this operation is dependent on system ingest load

  In rare cases where data-persistence deployment fails because the
  `postgres-db-migration` times out, it may be required to manually remove the
  index and then redeploy:

  ```text
  > DROP INDEX IF EXISTS postgres-db-migration;
  DROP INDEX
  ```

### Changed

- **CUMULUS-2955**
  - Updates `20220126172008_files_granule_id_index` to *not* create an index on
    `granule_cumulus_id` on the files table.
  - Adds `20220609024044_remove_files_granule_id_index` migration to revert
    changes from `20220126172008_files_granule_id_index` on any deployed stacks
    that might have the index to ensure consistency in deployed stacks

## [v11.1.1] 2022-04-26

### Added

### Changed

- **CUMULUS-2885**
  - Updated `@cumulus/aws-client` to use new AWS SDK v3 packages for S3 requests:
    - `@aws-sdk/client-s3`
    - `@aws-sdk/lib-storage`
    - `@aws-sdk/s3-request-presigner`
  - Updated code for compatibility with updated `@cumulus/aws-client` and AWS SDK v3 S3 packages:
    - `@cumulus/api`
    - `@cumulus/async-operations`
    - `@cumulus/cmrjs`
    - `@cumulus/common`
    - `@cumulus/collection-config-store`
    - `@cumulus/ingest`
    - `@cumulus/launchpad-auth`
    - `@cumulus/sftp-client`
    - `@cumulus/tf-inventory`
    - `lambdas/data-migration2`
    - `tasks/add-missing-file-checksums`
    - `tasks/hyrax-metadata-updates`
    - `tasks/lzards-backup`
    - `tasks/sync-granule`
- **CUMULUS-2886**
  - Updated `@cumulus/aws-client` to use new AWS SDK v3 packages for API Gateway requests:
    - `@aws-sdk/client-api-gateway`
- **CUMULUS-2920**
  - Update npm version for Core build to 8.6
- **CUMULUS-2922**
  - Added `@cumulus/example-lib` package to example project to allow unit tests `example/script/lib` dependency.
  - Updates Mutex unit test to address changes made in [#2902](https://github.com/nasa/cumulus/pull/2902/files)
- **CUMULUS-2924**
  - Update acquireTimeoutMillis to 400 seconds for the db-provision-lambda module to address potential timeout issues on RDS database start
- **CUMULUS-2925**
  - Updates CI to utilize `audit-ci` v6.2.0
  - Updates CI to utilize a on-container filesystem when building Core in 'uncached' mode
  - Updates CI to selectively bootstrap Core modules in the cleanup job phase
- **CUMULUS-2934**
  - Update CI Docker container build to install pipenv to prevent contention on parallel lambda builds


## [v11.1.0] 2022-04-07

### MIGRATION NOTES

- 11.1.0 is an amendment release and supersedes 11.0.0. However, follow the migration steps for 11.0.0.

- **CUMULUS-2905**
  - Updates migration script with new `migrateAndOverwrite` and
    `migrateOnlyFiles` options.

### Added

- **CUMULUS-2860**
  - Added an optional configuration parameter `skipMetadataValidation` to `hyrax-metadata-updates` task
- **CUMULUS-2870**
  - Added `last_modified_date` as output to all tasks in Terraform `ingest` module.
- **CUMULUS-NONE**
  - Added documentation on choosing and configuring RDS at `deployment/choosing_configuring_rds`.

### Changed

- **CUMULUS-2703**
  - Updated `ORCA Backup` reconciliation report to report `cumulusFilesCount` and `orcaFilesCount`
- **CUMULUS-2849**
  - Updated `@cumulus/aws-client` to use new AWS SDK v3 packages for DynamoDB requests:
    - `@aws-sdk/client-dynamodb`
    - `@aws-sdk/lib-dynamodb`
    - `@aws-sdk/util-dynamodb`
  - Updated code for compatibility with AWS SDK v3 Dynamo packages
    - `@cumulus/api`
    - `@cumulus/errors`
    - `@cumulus/tf-inventory`
    - `lambdas/data-migration2`
    - `packages/api/ecs/async-operation`
- **CUMULUS-2864**
  - Updated `@cumulus/cmr-client/ingestUMMGranule` and `@cumulus/cmr-client/ingestConcept`
    functions to not perform separate validation request
- **CUMULUS-2870**
  - Updated `hello_world_service` module to pass in `lastModified` parameter in command list to trigger a Terraform state change when the `hello_world_task` is modified.

### Fixed

- **CUMULUS-2849**
  - Fixed AWS service client memoization logic in `@cumulus/aws-client`

## [v11.0.0] 2022-03-24 [STABLE]

### v9.9->v11.0 MIGRATION NOTES

Release v11.0 is a maintenance release series, replacing v9.9.   If you are
upgrading to or past v11 from v9.9.x to this release, please pay attention to the following
migration notes from prior releases:

#### Migration steps

##### **After deploying the `data-persistence` module, but before deploying the main `cumulus` module**

- Due to a bug in the PUT `/rules/<name>` endpoint, the rule records in PostgreSQL may be
out of sync with records in DynamoDB. In order to bring the records into sync, re-deploy and re-run the
[`data-migration1` Lambda](https://nasa.github.io/cumulus/docs/upgrade-notes/upgrade-rds#3-deploy-and-run-data-migration1) with a payload of
`{"forceRulesMigration": true}`:

```shell
aws lambda invoke --function-name $PREFIX-data-migration1 \
  --payload $(echo '{"forceRulesMigration": true}' | base64) $OUTFILE
```

##### As part of the `cumulus` deployment

- Please read the [documentation on the updates to the granule files schema for our Cumulus workflow tasks and how to upgrade your deployment for compatibility](https://nasa.github.io/cumulus/docs/upgrade-notes/update-task-file-schemas).
- (Optional) Update the `task-config` for all workflows that use the `sync-granule` task to include `workflowStartTime` set to
`{$.cumulus_meta.workflow_start_time}`. See [here](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/sync_granule_workflow.asl.json#L9) for an example.

##### After the `cumulus` deployment

As part of the work on the RDS Phase 2 feature, it was decided to re-add the
granule file `type` property on the file table (detailed reasoning
https://wiki.earthdata.nasa.gov/pages/viewpage.action?pageId=219186829).  This
change was implemented as part of CUMULUS-2672/CUMULUS-2673, however granule
records ingested prior to v11 will *not* have the file.type property stored in the
PostGreSQL database, and on installation of v11 API calls to get granule.files
will not return this value. We anticipate most users are impacted by this issue.

Users that are impacted by these changes should re-run the granule migration
lambda to *only* migrate granule file records:

```shell
PAYLOAD=$(echo '{"migrationsList": ["granules"], "granuleMigrationParams": {"migrateOnlyFiles": "true"}}' | base64)
aws lambda invoke --function-name $PREFIX-postgres-migration-async-operation \
--payload $PAYLOAD $OUTFILE
```

You should note that this will *only* move files for granule records in
PostgreSQL.  **If you have not completed the phase 1 data migration or
have granule records in dynamo that are not in PostgreSQL, the migration will
report failure for both the DynamoDB granule and all the associated files and the file
records will not be updated**.

If you prefer to do a full granule and file migration, you may instead
opt to run the migration with the `migrateAndOverwrite` option instead, this will re-run a
full granule/files migration and overwrite all values in the PostgreSQL database from
what is in DynamoDB for both granules and associated files:

```shell
PAYLOAD=$(echo '{"migrationsList": ["granules"], "granuleMigrationParams": {"migrateAndOverwrite": "true"}}' | base64)
aws lambda invoke --function-name $PREFIX-postgres-migration-async-operation \
--payload $PAYLOAD $OUTFILE
```

*Please note*: Since this data migration is copying all of your granule data
from DynamoDB to PostgreSQL, it can take multiple hours (or even days) to run,
depending on how much data you have and how much parallelism you configure the
migration to use. In general, the more parallelism you configure the migration
to use, the faster it will go, but the higher load it will put on your
PostgreSQL database. Excessive database load can cause database outages and
result in data loss/recovery scenarios. Thus, the parallelism settings for the
migration are intentionally set by default to conservative values but are
configurable.      If this impacts only some of your data products you may want
to consider using other `granuleMigrationParams`.

Please see [the second data migration
docs](https://nasa.github.io/cumulus/docs/upgrade-notes/upgrade-rds#5-run-the-second-data-migration)
for more on this tool if you are unfamiliar with the various options.

### Notable changes

- **CUMULUS-2703**
  - `ORCA Backup` is now a supported `reportType` for the `POST /reconciliationReports` endpoint

### Added

- **CUMULUS-2311** - RDS Migration Epic Phase 2
  - **CUMULUS-2208**
    - Added `@cumulus/message/utils.parseException` to parse exception objects
    - Added helpers to `@cumulus/message/Granules`:
      - `getGranuleProductVolume`
      - `getGranuleTimeToPreprocess`
      - `getGranuleTimeToArchive`
      - `generateGranuleApiRecord`
    - Added `@cumulus/message/PDRs/generatePdrApiRecordFromMessage` to generate PDR from Cumulus workflow message
    - Added helpers to `@cumulus/es-client/indexer`:
      - `deleteAsyncOperation` to delete async operation records from Elasticsearch
      - `updateAsyncOperation` to update an async operation record in Elasticsearch
    - Added granules `PUT` endpoint to Cumulus API for updating a granule.
    Requests to this endpoint should be submitted **without an `action`**
    attribute in the request body.
    - Added `@cumulus/api-client/granules.updateGranule` to update granule via the API
  - **CUMULUS-2303**
    - Add translatePostgresProviderToApiProvider method to `@cumulus/db/translate/providers`
  - **CUMULUS-2306**
    - Updated API execution GET endpoint to read individual execution records
      from PostgreSQL database instead of DynamoDB
    - Updated API execution-status endpoint to read execution records from
      PostgreSQL database instead of DynamoDB
  - **CUMULUS-2302**
    - Added translatePostgresCollectionToApiCollection method to
      `@cumulus/db/translate/collections`
    - Added `searchWithUpdatedAtRange` method to
      `@cumulus/db/models/collections`
  - **CUMULUS-2301**
    - Created API asyncOperations POST endpoint to create async operations.
  - **CUMULUS-2307**
    - Updated API PDR GET endpoint to read individual PDR records from
      PostgreSQL database instead of DynamoDB
    - Added `deletePdr` to `@cumulus/api-client/pdrs`
  - **CUMULUS-2782**
    - Update API granules endpoint `move` action to update granules in the index
      and utilize postgres as the authoritative datastore
  - **CUMULUS-2769**
    - Update collection PUT endpoint to require existance of postgresql record
      and to ignore lack of dynamoDbRecord on update
  - **CUMULUS-2767**
    - Update provider PUT endpoint to require existence of PostgreSQL record
      and to ignore lack of DynamoDB record on update
  - **CUMULUS-2759**
    - Updates collection/provider/rules/granules creation (post) endpoints to
      primarily check for existence/collision in PostgreSQL database instead of DynamoDB
  - **CUMULUS-2714**
    - Added `@cumulus/db/base.deleteExcluding` method to allow for deletion of a
      record set with an exclusion list of cumulus_ids
  - **CUMULUS-2317**
    - Added `@cumulus/db/getFilesAndGranuleInfoQuery()` to build a query for searching file
    records in PostgreSQL and return specified granule information for each file
    - Added `@cumulus/db/QuerySearchClient` library to handle sequentially fetching and paging
    through results for an arbitrary PostgreSQL query
    - Added `insert` method to all `@cumulus/db` models to handle inserting multiple records into
    the database at once
    - Added `@cumulus/db/translatePostgresGranuleResultToApiGranule` helper to
    translate custom PostgreSQL granule result to API granule
  - **CUMULUS-2672**
    - Added migration to add `type` text column to Postgres database `files` table
  - **CUMULUS-2634**
    - Added new functions for upserting data to Elasticsearch:
      - `@cumulus/es-client/indexer.upsertExecution` to upsert an execution
      - `@cumulus/es-client/indexer.upsertPdr` to upsert a PDR
      - `@cumulus/es-client/indexer.upsertGranule` to upsert a granule
  - **CUMULUS-2510**
    - Added `execution_sns_topic_arn` environment variable to
      `sf_event_sqs_to_db_records` lambda TF definition.
    - Added to `sf_event_sqs_to_db_records_lambda` IAM policy to include
      permissions for SNS publish for `report_executions_topic`
    - Added `collection_sns_topic_arn` environment variable to
      `PrivateApiLambda` and `ApiEndpoints` lambdas.
    - Added `updateCollection` to `@cumulus/api-client`.
    - Added to `ecs_cluster` IAM policy to include permissions for SNS publish
      for `report_executions_sns_topic_arn`, `report_pdrs_sns_topic_arn`,
      `report_granules_sns_topic_arn`
    - Added variables for report topic ARNs to `process_dead_letter_archive.tf`
    - Added variable for granule report topic ARN to `bulk_operation.tf`
    - Added `pdr_sns_topic_arn` environment variable to
      `sf_event_sqs_to_db_records` lambda TF definition.
    - Added the new function `publishSnsMessageByDataType` in `@cumulus/api` to
      publish SNS messages to the report topics to PDRs, Collections, and
      Executions.
    - Added the following functions in `publishSnsMessageUtils` to handle
      publishing SNS messages for specific data and event types:
      - `publishCollectionUpdateSnsMessage`
      - `publishCollectionCreateSnsMessage`
      - `publishCollectionDeleteSnsMessage`
      - `publishGranuleUpdateSnsMessage`
      - `publishGranuleDeleteSnsMessage`
      - `publishGranuleCreateSnsMessage`
      - `publishExecutionSnsMessage`
      - `publishPdrSnsMessage`
      - `publishGranuleSnsMessageByEventType`
    - Added to `ecs_cluster` IAM policy to include permissions for SNS publish
      for `report_executions_topic` and `report_pdrs_topic`.
  - **CUMULUS-2315**
    - Added `paginateByCumulusId` to `@cumulus/db` `BasePgModel` to allow for paginated
      full-table select queries in support of elasticsearch indexing.
    - Added `getMaxCumulusId` to `@cumulus/db` `BasePgModel` to allow all
      derived table classes to support querying the current max `cumulus_id`.
  - **CUMULUS-2673**
    - Added `ES_HOST` environment variable to `postgres-migration-async-operation`
    Lambda using value of `elasticsearch_hostname` Terraform variable.
    - Added `elasticsearch_security_group_id` to security groups for
      `postgres-migration-async-operation` lambda.
    - Added permission for `DynamoDb:DeleteItem` to
      `postgres-migration-async-operation` lambda.
  - **CUMULUS-2778**
    - Updated default value of `async_operation_image` in
      `tf-modules/cumulus/variables.tf` to `cumuluss/async-operation:41`
    - Added `ES_HOST` environment variable to async operation ECS task
      definition to ensure that async operation tasks write to the correct
      Elasticsearch domain
- **CUMULUS-2642**
  - Reduces the reconcilation report's default maxResponseSize that returns
     the full report rather than an s3 signed url. Reports very close to the
     previous limits were failing to download, so the limit has been lowered to
     ensure all files are handled properly.
- **CUMULUS-2703**
  - Added `@cumulus/api/lambdas/reports/orca-backup-reconciliation-report` to create
    `ORCA Backup` reconciliation report

### Removed

- **CUMULUS-2311** - RDS Migration Epic Phase 2
  - **CUMULUS-2208**
    - Removed trigger for `dbIndexer` Lambda for DynamoDB tables:
      - `<prefix>-AsyncOperationsTable`
      - `<prefix>-CollectionsTable`
      - `<prefix>-ExecutionsTable`
      - `<prefix>-GranulesTable`
      - `<prefix>-PdrsTable`
      - `<prefix>-ProvidersTable`
      - `<prefix>-RulesTable`
  - **CUMULUS-2782**
    - Remove deprecated `@ingest/granule.moveGranuleFiles`
  - **CUMULUS-2770**
    - Removed `waitForModelStatus` from `example/spec/helpers/apiUtils` integration test helpers
  - **CUMULUS-2510**
    - Removed `stream_enabled` and `stream_view_type` from `executions_table` TF
      definition.
    - Removed `aws_lambda_event_source_mapping` TF definition on executions
      DynamoDB table.
    - Removed `stream_enabled` and `stream_view_type` from `collections_table`
      TF definition.
    - Removed `aws_lambda_event_source_mapping` TF definition on collections
      DynamoDB table.
    - Removed lambda `publish_collections` TF resource.
    - Removed `aws_lambda_event_source_mapping` TF definition on granules
    - Removed `stream_enabled` and `stream_view_type` from `pdrs_table` TF
      definition.
    - Removed `aws_lambda_event_source_mapping` TF definition on PDRs
      DynamoDB table.
  - **CUMULUS-2694**
    - Removed `@cumulus/api/models/granules.storeGranulesFromCumulusMessage()` method
  - **CUMULUS-2662**
    - Removed call to `addToLocalES` in POST `/granules` endpoint since it is
      redundant.
    - Removed call to `addToLocalES` in POST and PUT `/executions` endpoints
      since it is redundant.
    - Removed function `addToLocalES` from `es-client` package since it is no
      longer used.
  - **CUMULUS-2771**
    - Removed `_updateGranuleStatus` to update granule to "running" from `@cumulus/api/lib/ingest.reingestGranule`
    and `@cumulus/api/lib/ingest.applyWorkflow`

### Changed

- CVE-2022-2477
  - Update node-forge to 1.3.0 in `@cumulus/common` to address CVE-2022-2477
- **CUMULUS-2311** - RDS Migration Epic Phase 2
  - **CUMULUS_2641**
    - Update API granule schema to set productVolume as a string value
    - Update `@cumulus/message` package to set productVolume as string
      (calculated with `file.size` as a `BigInt`) to match API schema
    - Update `@cumulus/db` granule translation to translate `granule` objects to
      match the updated API schema
  - **CUMULUS-2714**
    - Updated
      - @cumulus/api/lib.writeRecords.writeGranulesFromMessage
      - @cumulus/api/lib.writeRecords.writeGranuleFromApi
      - @cumulus/api/lib.writeRecords.createGranuleFromApi
      - @cumulus/api/lib.writeRecords.updateGranuleFromApi
    - These methods now remove postgres file records that aren't contained in
        the write/update action if such file records exist.  This update
        maintains consistency with the writes to elasticsearch/dynamodb.
  - **CUMULUS-2672**
    - Updated `data-migration2` lambda to migrate Dynamo `granule.files[].type`
      instead of dropping it.
    - Updated `@cumlus/db` `translateApiFiletoPostgresFile` to retain `type`
    - Updated `@cumulus/db` `translatePostgresFileToApiFile` to retain `type`
    - Updated `@cumulus/types.api.file` to add `type` to the typing.
  - **CUMULUS-2315**
    - Update `index-from-database` lambda/ECS task and elasticsearch endpoint to read
      from PostgreSQL database
    - Update `index-from-database` endpoint to add the following configuration
      tuning parameters:
      - postgresResultPageSize -- The number of records to read from each
        postgres table per request.   Default is 1000.
      - postgresConnectionPoolSize -- The max number of connections to allow the
        index function to make to the database.  Default is 10.
      - esRequestConcurrency -- The maximium number of concurrent record
        translation/ES record update requests.   Default is 10.
  - **CUMULUS-2308**
    - Update `/granules/<granule_id>` GET endpoint to return PostgreSQL Granules instead of DynamoDB Granules
    - Update `/granules/<granule_id>` PUT endpoint to use PostgreSQL Granule as source rather than DynamoDB Granule
    - Update `unpublishGranule` (used in /granules PUT) to use PostgreSQL Granule as source rather than DynamoDB Granule
    - Update integration tests to use `waitForApiStatus` instead of `waitForModelStatus`
    - Update Granule ingest to update the Postgres Granule status as well as the DynamoDB Granule status
  - **CUMULUS-2302**
    - Update API collection GET endpoint to read individual provider records from
      PostgreSQL database instead of DynamoDB
    - Update sf-scheduler lambda to utilize API endpoint to get provider record
      from database via Private API lambda
    - Update API granule `reingest` endpoint to read collection from PostgreSQL
      database instead of DynamoDB
    - Update internal-reconciliation report to base report Collection comparison
      on PostgreSQL instead of DynamoDB
    - Moved createGranuleAndFiles `@cumulus/api` unit helper from `./lib` to
      `.test/helpers`
  - **CUMULUS-2208**
    - Moved all `@cumulus/api/es/*` code to new `@cumulus/es-client` package
    - Updated logic for collections API POST/PUT/DELETE to create/update/delete
      records directly in Elasticsearch in parallel with updates to
      DynamoDb/PostgreSQL
    - Updated logic for rules API POST/PUT/DELETE to create/update/delete
      records directly in Elasticsearch in parallel with updates to
      DynamoDb/PostgreSQL
    - Updated logic for providers API POST/PUT/DELETE to create/update/delete
      records directly in  Elasticsearch in parallel with updates to
      DynamoDb/PostgreSQL
    - Updated logic for PDRs API DELETE to delete records directly in
      Elasticsearch in parallel with deletes to DynamoDB/PostgreSQL
    - Updated logic for executions API DELETE to delete records directly in
      Elasticsearch in parallel with deletes to DynamoDB/PostgreSQL
    - Updated logic for granules API DELETE to delete records directly in
      Elasticsearch in parallel with deletes to DynamoDB/PostgreSQL
    - `sfEventSqsToDbRecords` Lambda now writes following data directly to
      Elasticsearch in parallel with writes to DynamoDB/PostgreSQL:
      - executions
      - PDRs
      - granules
    - All async operations are now written directly to Elasticsearch in parallel
      with DynamoDB/PostgreSQL
    - Updated logic for async operation API DELETE to delete records directly in
      Elasticsearch in parallel with deletes to DynamoDB/PostgreSQL
    - Moved:
      - `packages/api/lib/granules.getGranuleProductVolume` ->
      `@cumulus/message/Granules.getGranuleProductVolume`
      - `packages/api/lib/granules.getGranuleTimeToPreprocess`
      -> `@cumulus/message/Granules.getGranuleTimeToPreprocess`
      - `packages/api/lib/granules.getGranuleTimeToArchive` ->
      `@cumulus/message/Granules.getGranuleTimeToArchive`
      - `packages/api/models/Granule.generateGranuleRecord`
      -> `@cumulus/message/Granules.generateGranuleApiRecord`
  - **CUMULUS-2306**
    - Updated API local serve (`api/bin/serve.js`) setup code to add cleanup/executions
    related records
    - Updated @cumulus/db/models/granules-executions to add a delete method in
      support of local cleanup
    - Add spec/helpers/apiUtils/waitForApiStatus integration helper to retry API
      record retrievals on status in lieu of using `waitForModelStatus`
  - **CUMULUS-2303**
    - Update API provider GET endpoint to read individual provider records from
      PostgreSQL database instead of DynamoDB
    - Update sf-scheduler lambda to utilize API endpoint to get provider record
      from database via Private API lambda
  - **CUMULUS-2301**
    - Updated `getAsyncOperation` to read from PostgreSQL database instead of
      DynamoDB.
    - Added `translatePostgresAsyncOperationToApiAsyncOperation` function in
      `@cumulus/db/translate/async-operation`.
    - Updated `translateApiAsyncOperationToPostgresAsyncOperation` function to
      ensure that `output` is properly translated to an object for the
      PostgreSQL record for the following cases of `output` on the incoming API
      record:
      - `record.output` is a JSON stringified object
      - `record.output` is a JSON stringified array
      - `record.output` is a JSON stringified string
      - `record.output` is a string
  - **CUMULUS-2317**
    - Changed reconciliation reports to read file records from PostgreSQL instead of DynamoDB
  - **CUMULUS-2304**
    - Updated API rule GET endpoint to read individual rule records from
      PostgreSQL database instead of DynamoDB
    - Updated internal consumer lambdas for SNS, SQS and Kinesis to read
      rules from PostgreSQL.
  - **CUMULUS-2634**
    - Changed `sfEventSqsToDbRecords` Lambda to use new upsert helpers for executions, granules, and PDRs
    to ensure out-of-order writes are handled correctly when writing to Elasticsearch
  - **CUMULUS-2510**
    - Updated `@cumulus/api/lib/writeRecords/write-execution` to publish SNS
      messages after a successful write to Postgres, DynamoDB, and ES.
    - Updated functions `create` and `upsert` in the `db` model for Executions
      to return an array of objects containing all columns of the created or
      updated records.
    - Updated `@cumulus/api/endpoints/collections` to publish an SNS message
      after a successful collection delete, update (PUT), create (POST).
    - Updated functions `create` and `upsert` in the `db` model for Collections
      to return an array of objects containing all columns for the created or
      updated records.
    - Updated functions `create` and `upsert` in the `db` model for Granules
      to return an array of objects containing all columns for the created or
      updated records.
    - Updated `@cumulus/api/lib/writeRecords/write-granules` to publish SNS
      messages after a successful write to Postgres, DynamoDB, and ES.
    - Updated `@cumulus/api/lib/writeRecords/write-pdr` to publish SNS
      messages after a successful write to Postgres, DynamoDB, and ES.
  - **CUMULUS-2733**
    - Updated `_writeGranuleFiles` function creates an aggregate error which
      contains the workflow error, if any, as well as any error that may occur
      from writing granule files.
  - **CUMULUS-2674**
    - Updated `DELETE` endpoints for the following data types to check that record exists in
      PostgreSQL or Elasticsearch before proceeding with deletion:
      - `provider`
      - `async operations`
      - `collections`
      - `granules`
      - `executions`
      - `PDRs`
      - `rules`
  - **CUMULUS-2294**
    - Updated architecture and deployment documentation to reference RDS
  - **CUMULUS-2642**
    - Inventory and Granule Not Found Reconciliation Reports now compare
      Databse against S3 in on direction only, from Database to S3
      Objects. This means that only files in the database are compared against
      objects found on S3 and the filesInCumulus.onlyInS3 report key will
      always be empty. This significantly decreases the report output size and
      aligns with a users expectations.
    - Updates getFilesAndGranuleInfoQuery to take additional optional
      parameters `collectionIds`, `granuleIds`, and `providers` to allow
      targeting/filtering of the results.

  - **CUMULUS-2694**
    - Updated database write logic in `sfEventSqsToDbRccords` to log message if Cumulus
    workflow message is from pre-RDS deployment but still attempt parallel writing to DynamoDB
    and PostgreSQL
    - Updated database write logic in `sfEventSqsToDbRccords` to throw error if requirements to write execution to PostgreSQL cannot be met
  - **CUMULUS-2660**
    - Updated POST `/executions` endpoint to publish SNS message of created record to executions SNS topic
  - **CUMULUS-2661**
    - Updated PUT `/executions/<arn>` endpoint to publish SNS message of updated record to executions SNS topic
  - **CUMULUS-2765**
    - Updated `updateGranuleStatusToQueued` in `write-granules` to write to
      Elasticsearch and publish SNS message to granules topic.
  - **CUMULUS-2774**
    - Updated `constructGranuleSnsMessage` and `constructCollectionSnsMessage`
      to throw error if `eventType` is invalid or undefined.
  - **CUMULUS-2776**
    - Updated `getTableIndexDetails` in `db-indexer` to use correct
      `deleteFnName` for reconciliation reports.
  - **CUMULUS-2780**
    - Updated bulk granule reingest operation to read granules from PostgreSQL instead of DynamoDB.
  - **CUMULUS-2778**
    - Updated default value of `async_operation_image` in `tf-modules/cumulus/variables.tf` to `cumuluss/async-operation:38`
  - **CUMULUS-2854**
    - Updated rules model to decouple `createRuleTrigger` from `create`.
    - Updated rules POST endpoint to call `rulesModel.createRuleTrigger` directly to create rule trigger.
    - Updated rules PUT endpoints to call `rulesModel.createRuleTrigger` if update fails and reversion needs to occur.

### Fixed

- **CUMULUS-2311** - RDS Migration Epic Phase 2
  - **CUMULUS-2810**
    - Updated @cumulus/db/translate/translatePostgresProviderToApiProvider to
      correctly return provider password and updated tests to prevent
      reintroduction.
  - **CUMULUS-2778**
    - Fixed async operation docker image to correctly update record status in
    Elasticsearch
  - Updated localAPI to set additional env variable, and fixed `GET /executions/status` response
  - **CUMULUS-2877**
    - Ensure database records receive a timestamp when writing granules.

## [v10.1.3] 2022-06-28 [BACKPORT]

### Added

- **CUMULUS-2966**
  - Added extractPath operation and support of nested string replacement to `url_path` in the collection configuration

## [v10.1.2] 2022-03-11

### Added

- **CUMULUS-2859**
  - Update `postgres-db-migration` lambda timeout to default 900 seconds
  - Add `db_migration_lambda_timeout` variable to `data-persistence` module to
    allow this timeout to be user configurable
- **CUMULUS-2868**
  - Added `iam:PassRole` permission to `step_policy` in `tf-modules/ingest/iam.tf`

## [v10.1.1] 2022-03-04

### Migration steps

- Due to a bug in the PUT `/rules/<name>` endpoint, the rule records in PostgreSQL may be
out of sync with records in DynamoDB. In order to bring the records into sync, re-run the
[previously deployed `data-migration1` Lambda](https://nasa.github.io/cumulus/docs/upgrade-notes/upgrade-rds#3-deploy-and-run-data-migration1) with a payload of
`{"forceRulesMigration": true}`:

```shell
aws lambda invoke --function-name $PREFIX-data-migration1 \
  --payload $(echo '{"forceRulesMigration": true}' | base64) $OUTFILE
```

### Added

- **CUMULUS-2841**
  - Add integration test to validate PDR node provider that requires password
    credentials succeeds on ingest

- **CUMULUS-2846**
  - Added `@cumulus/db/translate/rule.translateApiRuleToPostgresRuleRaw` to translate API rule to PostgreSQL rules and
  **keep undefined fields**

### Changed

- **CUMULUS-NONE**
  - Adds logging to ecs/async-operation Docker container that launches async
    tasks on ECS. Sets default async_operation_image_version to 39.

- **CUMULUS-2845**
  - Updated rules model to decouple `createRuleTrigger` from `create`.
  - Updated rules POST endpoint to call `rulesModel.createRuleTrigger` directly to create rule trigger.
  - Updated rules PUT endpoints to call `rulesModel.createRuleTrigger` if update fails and reversion needs to occur.
- **CUMULUS-2846**
  - Updated version of `localstack/localstack` used in local unit testing to `0.11.5`

### Fixed

- Upgraded lodash to version 4.17.21 to fix vulnerability
- **CUMULUS-2845**
  - Fixed bug in POST `/rules` endpoint causing rule records to be created
  inconsistently in DynamoDB and PostgreSQL
- **CUMULUS-2846**
  - Fixed logic for `PUT /rules/<name>` endpoint causing rules to be saved
  inconsistently between DynamoDB and PostgreSQL
- **CUMULUS-2854**
  - Fixed queue granules behavior where the task was not accounting for granules that
  *already* had createdAt set. Workflows downstream in this scenario should no longer
  fail to write their granules due to order-of-db-writes constraints in the database
  update logic.

## [v10.1.0] 2022-02-23

### Added

- **CUMULUS-2775**
  - Added a configurable parameter group for the RDS serverless database cluster deployed by `tf-modules/rds-cluster-tf`. The allowed parameters for the parameter group can be found in the AWS documentation of [allowed parameters for an Aurora PostgreSQL cluster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Reference.ParameterGroups.html). By default, the following parameters are specified:
    - `shared_preload_libraries`: `pg_stat_statements,auto_explain`
    - `log_min_duration_statement`: `250`
    - `auto_explain.log_min_duration`: `250`
- **CUMULUS-2781**
  - Add api_config secret to hold API/Private API lambda configuration values
- **CUMULUS-2840**
  - Added an index on `granule_cumulus_id` to the RDS files table.

### Changed

- **CUMULUS-2492**
  - Modify collectionId logic to accomodate trailing underscores in collection short names. e.g. `shortName____`
- **CUMULUS-2847**
  - Move DyanmoDb table name into API keystore and initialize only on lambda cold start
- **CUMULUS-2833**
  - Updates provider model schema titles to display on the dashboard.
- **CUMULUS-2837**
  - Update process-s3-dead-letter-archive to unpack SQS events in addition to
    Cumulus Messages
  - Update process-s3-dead-letter-archive to look up execution status using
    getCumulusMessageFromExecutionEvent (common method with sfEventSqsToDbRecords)
  - Move methods in api/lib/cwSfExecutionEventUtils to
    @cumulus/message/StepFunctions
- **CUMULUS-2775**
  - Changed the `timeout_action` to `ForceApplyCapacityChange` by default for the RDS serverless database cluster `tf-modules/rds-cluster-tf`
- **CUMULUS-2781**
  - Update API lambda to utilize api_config secret for initial environment variables

### Fixed

- **CUMULUS-2853**
  - Move OAUTH_PROVIDER to lambda env variables to address regression in CUMULUS-2781
  - Add logging output to api app router
- Added Cloudwatch permissions to `<prefix>-steprole` in `tf-modules/ingest/iam.tf` to address the
`Error: error creating Step Function State Machine (xxx): AccessDeniedException: 'arn:aws:iam::XXX:role/xxx-steprole' is not authorized to create managed-rule`
error in non-NGAP accounts:
  - `events:PutTargets`
  - `events:PutRule`
  - `events:DescribeRule`

## [v10.0.1] 2022-02-03

### Fixed

- Fixed IAM permissions issue with `<prefix>-postgres-migration-async-operation` Lambda
which prevented it from running a Fargate task for data migration.

## [v10.0.0] 2022-02-01

### Migration steps

- Please read the [documentation on the updates to the granule files schema for our Cumulus workflow tasks and how to upgrade your deployment for compatibility](https://nasa.github.io/cumulus/docs/upgrade-notes/update-task-file-schemas).
- (Optional) Update the `task-config` for all workflows that use the `sync-granule` task to include `workflowStartTime` set to
`{$.cumulus_meta.workflow_start_time}`. See [here](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/sync_granule_workflow.asl.json#L9) for an example.

### BREAKING CHANGES

- **NDCUM-624**
  - Functions in @cumulus/cmrjs renamed for consistency with `isCMRFilename` and `isCMRFile`
    - `isECHO10File` -> `isECHO10Filename`
    - `isUMMGFile` -> `isUMMGFilename`
    - `isISOFile` -> `isCMRISOFilename`
- **CUMULUS-2388**
  - In order to standardize task messaging formats, please note the updated input, output and config schemas for the following Cumulus workflow tasks:
    - add-missing-file-checksums
    - files-to-granules
    - hyrax-metadata-updates
    - lzards-backup
    - move-granules
    - post-to-cmr
    - sync-granule
    - update-cmr-access-constraints
    - update-granules-cmr-metadata-file-links
  The primary focus of the schema updates was to standardize the format of granules, and
  particularly their files data. The granule `files` object now matches the file schema in the
  Cumulus database and thus also matches the `files` object produced by the API with use cases like
  `applyWorkflow`. This includes removal of `name` and `filename` in favor of `bucket` and `key`,
  removal of certain properties such as `etag` and `duplicate_found` and outputting them as
  separate objects stored in `meta`.
  - Checksum values calculated by `@cumulus/checksum` are now converted to string to standardize
  checksum formatting across the Cumulus library.

### Notable changes

- **CUMULUS-2718**
  - The `sync-granule` task has been updated to support an optional configuration parameter `workflowStartTime`. The output payload of `sync-granule` now includes a `createdAt` time for each granule which is set to the
  provided `workflowStartTime` or falls back to `Date.now()` if not provided. Workflows using
  `sync-granule` may be updated to include this parameter with the value of `{$.cumulus_meta.workflow_start_time}` in the `task_config`.
- Updated version of `@cumulus/cumulus-message-adapter-js` from `2.0.3` to `2.0.4` for
all Cumulus workflow tasks
- **CUMULUS-2783**
  - A bug in the ECS cluster autoscaling configuration has been
resolved. ECS clusters should now correctly autoscale by adding new cluster
instances according to the [policy configuration](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus/ecs_cluster.tf).
  - Async operations that are started by these endpoints will be run as ECS tasks
  with a launch type of Fargate, not EC2:
    - `POST /deadLetterArchive/recoverCumulusMessages`
    - `POST /elasticsearch/index-from-database`
    - `POST /granules/bulk`
    - `POST /granules/bulkDelete`
    - `POST /granules/bulkReingest`
    - `POST /migrationCounts`
    - `POST /reconciliationReports`
    - `POST /replays`
    - `POST /replays/sqs`

### Added

- Upgraded version of dependencies on `knex` package from `0.95.11` to `0.95.15`
- Added Terraform data sources to `example/cumulus-tf` module to retrieve default VPC and subnets in NGAP accounts
  - Added `vpc_tag_name` variable which defines the tags used to look up a VPC. Defaults to VPC tag name used in NGAP accounts
  - Added `subnets_tag_name` variable which defines the tags used to look up VPC subnets. Defaults to a subnet tag name used in NGAP accounts
- Added Terraform data sources to `example/data-persistence-tf` module to retrieve default VPC and subnets in NGAP accounts
  - Added `vpc_tag_name` variable which defines the tags used to look up a VPC. Defaults to VPC tag name used in NGAP accounts
  - Added `subnets_tag_name` variable which defines the tags used to look up VPC subnets. Defaults to a subnet tag name used in NGAP accounts
- Added Terraform data sources to `example/rds-cluster-tf` module to retrieve default VPC and subnets in NGAP accounts
  - Added `vpc_tag_name` variable which defines the tags used to look up a VPC. Defaults to VPC tag name used in NGAP accounts
  - Added `subnets_tag_name` variable which defines the tags used to look up VPC subnets. Defaults to tag names used in subnets in for NGAP accounts
- **CUMULUS-2299**
  - Added support for SHA checksum types with hyphens (e.g. `SHA-256` vs `SHA256`) to tasks that calculate checksums.
- **CUMULUS-2439**
  - Added CMR search client setting to the CreateReconciliationReport lambda function.
  - Added `cmr_search_client_config` tfvars to the archive and cumulus terraform modules.
  - Updated CreateReconciliationReport lambda to search CMR collections with CMRSearchConceptQueue.
- **CUMULUS-2441**
  - Added support for 'PROD' CMR environment.
- **CUMULUS-2456**
  - Updated api lambdas to query ORCA Private API
  - Updated example/cumulus-tf/orca.tf to the ORCA release v4.0.0-Beta3
- **CUMULUS-2638**
  - Adds documentation to clarify bucket config object use.
- **CUMULUS-2684**
  - Added optional collection level parameter `s3MultipartChunksizeMb` to collection's `meta` field
  - Updated `move-granules` task to take in an optional config parameter s3MultipartChunksizeMb
- **CUMULUS-2747**
  - Updated data management type doc to include additional fields for provider configurations
- **CUMULUS-2773**
  - Added a document to the workflow-tasks docs describing deployment, configuration and usage of the LZARDS backup task.

### Changed

- Made `vpc_id` variable optional for `example/cumulus-tf` module
- Made `vpc_id` and `subnet_ids` variables optional for `example/data-persistence-tf` module
- Made `vpc_id` and `subnets` variables optional for `example/rds-cluster-tf` module
- Changes audit script to handle integration test failure when `USE\_CACHED\_BOOTSTRAP` is disabled.
- Increases wait time for CMR to return online resources in integration tests
- **CUMULUS-1823**
  - Updates to Cumulus rule/provider schemas to improve field titles and descriptions.
- **CUMULUS-2638**
  - Transparent to users, remove typescript type `BucketType`.
- **CUMULUS-2718**
  - Updated config for SyncGranules to support optional `workflowStartTime`
  - Updated SyncGranules to provide `createdAt` on output based on `workflowStartTime` if provided,
  falling back to `Date.now()` if not provided.
  - Updated `task_config` of SyncGranule in example workflows
- **CUMULUS-2735**
  - Updated reconciliation reports to write formatted JSON to S3 to improve readability for
    large reports
  - Updated TEA version from 102 to 121 to address TEA deployment issue with the max size of
    a policy role being exceeded
- **CUMULUS-2743**
  - Updated bamboo Dockerfile to upgrade pip as part of the image creation process
- **CUMULUS-2744**
  - GET executions/status returns associated granules for executions retrieved from the Step Function API
- **CUMULUS-2751**
  - Upgraded all Cumulus (node.js) workflow tasks to use
    `@cumulus/cumulus-message-adapter-js` version `2.0.3`, which includes an
    update cma-js to better expose CMA stderr stream output on lambda timeouts
    as well as minor logging enhancements.
- **CUMULUS-2752**
  - Add new mappings for execution records to prevent dynamic field expansion from exceeding
  Elasticsearch field limits
    - Nested objects under `finalPayload.*` will not dynamically add new fields to mapping
    - Nested objects under `originalPayload.*` will not dynamically add new fields to mapping
    - Nested keys under `tasks` will not dynamically add new fields to mapping
- **CUMULUS-2753**
  - Updated example/cumulus-tf/orca.tf to the latest ORCA release v4.0.0-Beta2 which is compatible with granule.files file schema
  - Updated /orca/recovery to call new lambdas request_status_for_granule and request_status_for_job.
  - Updated orca integration test
- [**PR #2569**](https://github.com/nasa/cumulus/pull/2569)
  - Fixed `TypeError` thrown by `@cumulus/cmrjs/cmr-utils.getGranuleTemporalInfo` when
    a granule's associated UMM-G JSON metadata file does not contain a `ProviderDates`
    element that has a `Type` of either `"Update"` or `"Insert"`.  If neither are
    present, the granule's last update date falls back to the `"Create"` type
    provider date, or `undefined`, if none is present.
- **CUMULUS-2775**
  - Changed `@cumulus/api-client/invokeApi()` to accept a single accepted status code or an array
  of accepted status codes via `expectedStatusCodes`
- [**PR #2611**](https://github.com/nasa/cumulus/pull/2611)
  - Changed `@cumulus/launchpad-auth/LaunchpadToken.requestToken` and `validateToken`
    to use the HTTPS request option `https.pfx` instead of the deprecated `pfx` option
    for providing the certificate.
- **CUMULUS-2836**
  - Updates `cmr-utils/getGranuleTemporalInfo` to search for a SingleDateTime
    element, when beginningDateTime value is not
    found in the metadata file.  The granule's temporal information is
    returned so that both beginningDateTime and endingDateTime are set to the
    discovered singleDateTimeValue.
- **CUMULUS-2756**
  - Updated `_writeGranule()` in `write-granules.js` to catch failed granule writes due to schema validation, log the failure and then attempt to set the status of the granule to `failed` if it already exists to prevent a failure from allowing the granule to get "stuck" in a non-failed status.

### Fixed

- **CUMULUS-2775**
  - Updated `@cumulus/api-client` to not log an error for 201 response from `updateGranule`
- **CUMULUS-2783**
  - Added missing lower bound on scale out policy for ECS cluster to ensure that
  the cluster will autoscale correctly.
- **CUMULUS-2835**
  - Updated `hyrax-metadata-updates` task to support reading the DatasetId from ECHO10 XML, and the EntryTitle from UMM-G JSON; these are both valid alternatives to the shortname and version ID.

## [v9.9.3] 2021-02-17 [BACKPORT]

**Please note** changes in 9.9.3 may not yet be released in future versions, as
this is a backport and patch release on the 9.9.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

- **CUMULUS-2853**
  - Move OAUTH_PROVIDER to lambda env variables to address regression in 9.9.2/CUMULUS-2275
  - Add logging output to api app router

## [v9.9.2] 2021-02-10 [BACKPORT]

**Please note** changes in 9.9.2 may not yet be released in future versions, as
this is a backport and patch release on the 9.9.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.### Added

- **CUMULUS-2775**
  - Added a configurable parameter group for the RDS serverless database cluster deployed by `tf-modules/rds-cluster-tf`. The allowed parameters for the parameter group can be found in the AWS documentation of [allowed parameters for an Aurora PostgreSQL cluster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Reference.ParameterGroups.html). By default, the following parameters are specified:
    - `shared_preload_libraries`: `pg_stat_statements,auto_explain`
    - `log_min_duration_statement`: `250`
    - `auto_explain.log_min_duration`: `250`
- **CUMULUS-2840**
  - Added an index on `granule_cumulus_id` to the RDS files table.

### Changed

- **CUMULUS-2847**
  - Move DyanmoDb table name into API keystore and initialize only on lambda cold start
- **CUMULUS-2781**
  - Add api_config secret to hold API/Private API lambda configuration values
- **CUMULUS-2775**
  - Changed the `timeout_action` to `ForceApplyCapacityChange` by default for the RDS serverless database cluster `tf-modules/rds-cluster-tf`

## [v9.9.1] 2021-02-10 [BACKPORT]

**Please note** changes in 9.9.1 may not yet be released in future versions, as
this is a backport and patch release on the 9.9.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Fixed

- **CUMULUS-2775**
  - Updated `@cumulus/api-client` to not log an error for 201 response from `updateGranule`

### Changed

- Updated version of `@cumulus/cumulus-message-adapter-js` from `2.0.3` to `2.0.4` for
all Cumulus workflow tasks
- **CUMULUS-2775**
  - Changed `@cumulus/api-client/invokeApi()` to accept a single accepted status code or an array
  of accepted status codes via `expectedStatusCodes`
- **CUMULUS-2837**
  - Update process-s3-dead-letter-archive to unpack SQS events in addition to
    Cumulus Messages
  - Update process-s3-dead-letter-archive to look up execution status using
    getCumulusMessageFromExecutionEvent (common method with sfEventSqsToDbRecords)
  - Move methods in api/lib/cwSfExecutionEventUtils to
    @cumulus/message/StepFunctions

## [v9.9.0] 2021-11-03

### Added

- **NDCUM-624**: Add support for ISO metadata files for the `MoveGranules` step
  - Add function `isISOFile` to check if a given file object is an ISO file
  - `granuleToCmrFileObject` and `granulesToCmrFileObjects` now take a
    `filterFunc` argument
    - `filterFunc`'s default value is `isCMRFile`, so the previous behavior is
      maintained if no value is given for this argument
    - `MoveGranules` passes a custom filter function to
      `granulesToCmrFileObjects` to check for `isISOFile` in addition to
      `isCMRFile`, so that metadata from `.iso.xml` files can be used in the
      `urlPathTemplate`
- [**PR #2535**](https://github.com/nasa/cumulus/pull/2535)
  - NSIDC and other cumulus users had desire for returning formatted dates for
    the 'url_path' date extraction utilities. Added 'dateFormat' function as
    an option for extracting and formating the entire date. See
    docs/workflow/workflow-configuration-how-to.md for more information.
- [**PR #2548**](https://github.com/nasa/cumulus/pull/2548)
  - Updated webpack configuration for html-loader v2
- **CUMULUS-2640**
  - Added Elasticsearch client scroll setting to the CreateReconciliationReport lambda function.
  - Added `elasticsearch_client_config` tfvars to the archive and cumulus terraform modules.
- **CUMULUS-2683**
  - Added `default_s3_multipart_chunksize_mb` setting to the `move-granules` lambda function.
  - Added `default_s3_multipart_chunksize_mb` tfvars to the cumulus and ingest terraform modules.
  - Added optional parameter `chunkSize` to `@cumulus/aws-client/S3.moveObject` and
    `@cumulus/aws-client/S3.multipartCopyObject` to set the chunk size of the S3 multipart uploads.
  - Renamed optional parameter `maxChunkSize` to `chunkSize` in
    `@cumulus/aws-client/lib/S3MultipartUploads.createMultipartChunks`.

### Changed

- Upgraded all Cumulus workflow tasks to use `@cumulus/cumulus-message-adapter-js` version `2.0.1`
- **CUMULUS-2725**
  - Updated providers endpoint to return encrypted password
  - Updated providers model to try decrypting credentials before encryption to allow for better handling of updating providers
- **CUMULUS-2734**
  - Updated `@cumulus/api/launchpadSaml.launchpadPublicCertificate` to correctly retrieve
    certificate from launchpad IdP metadata with and without namespace prefix.

## [v9.8.0] 2021-10-19

### Notable changes

- Published new tag [`36` of `cumuluss/async-operation` to Docker Hub](https://hub.docker.com/layers/cumuluss/async-operation/35/images/sha256-cf777a6ef5081cd90a0f9302d45243b6c0a568e6d977c0ee2ccc5a90b12d45d0?context=explore) for compatibility with
upgrades to `knex` package and to address security vulnerabilities.

### Added

- Added `@cumulus/db/createRejectableTransaction()` to handle creating a Knex transaction that **will throw an error** if the transaction rolls back. [As of Knex 0.95+, promise rejection on transaction rollback is no longer the default behavior](https://github.com/knex/knex/blob/master/UPGRADING.md#upgrading-to-version-0950).

- **CUMULUS-2639**
  - Increases logging on reconciliation reports.

- **CUMULUS-2670**
  - Updated `lambda_timeouts` string map variable for `cumulus` module to accept a
  `update_granules_cmr_metadata_file_links_task_timeout` property
- **CUMULUS-2598**
  - Add unit and integration tests to describe queued granules as ignored when
    duplicate handling is 'skip'

### Changed

- Updated `knex` version from 0.23.11 to 0.95.11 to address security vulnerabilities
- Updated default version of async operations Docker image to `cumuluss/async-operation:36`
- **CUMULUS-2590**
  - Granule applyWorkflow, Reingest actions and Bulk operation now update granule status to `queued` when scheduling the granule.
- **CUMULUS-2643**
  - relocates system file `buckets.json` out of the
    `s3://internal-bucket/workflows` directory into
    `s3://internal-bucket/buckets`.


## [v9.7.1] 2021-12-08 [Backport]

Please note changes in 9.7.0 may not yet be released in future versions, as this is a backport and patch release on the 9.7.x series of releases. Updates that are included in the future will have a corresponding CHANGELOG entry in future releases.
Fixed

- **CUMULUS-2751**
  - Update all tasks to update to use cumulus-message-adapter-js version 2.0.4

## [v9.7.0] 2021-10-01

### Notable Changes

- **CUMULUS-2583**
  - The `queue-granules` task now updates granule status to `queued` when a granule is queued. In order to prevent issues with the private API endpoint and Lambda API request and concurrency limits, this functionality runs with limited concurrency, which may increase the task's overall runtime when large numbers of granules are being queued. If you are facing Lambda timeout errors with this task, we recommend converting your `queue-granules` task to an ECS activity. This concurrency is configurable via the task config's `concurrency` value.
- **CUMULUS-2676**
  - The `discover-granules` task has been updated to limit concurrency on checks to identify and skip already ingested granules in order to prevent issues with the private API endpoint and Lambda API request and concurrency limits. This may increase the task's overall runtime when large numbers of granules are discovered. If you are facing Lambda timeout errors with this task, we recommend converting your `discover-granules` task to an ECS activity. This concurrency is configurable via the task config's `concurrency` value.
- Updated memory of `<prefix>-sfEventSqsToDbRecords` Lambda to 1024MB

### Added

- **CUMULUS-2000**
  - Updated `@cumulus/queue-granules` to respect a new config parameter: `preferredQueueBatchSize`. Queue-granules will respect this batchsize as best as it can to batch granules into workflow payloads. As workflows generally rely on information such as collection and provider expected to be shared across all granules in a workflow, queue-granules will break batches up by collection, as well as provider if there is a `provider` field on the granule. This may result in batches that are smaller than the preferred size, but never larger ones. The default value is 1, which preserves current behavior of queueing 1 granule per workflow.
- **CUMULUS-2630**
  - Adds a new workflow `DiscoverGranulesToThrottledQueue` that discovers and writes
    granules to a throttled background queue.  This allows discovery and ingest
    of larger numbers of granules without running into limits with lambda
    concurrency.

### Changed

- **CUMULUS-2720**
  - Updated Core CI scripts to validate CHANGELOG diffs as part of the lint process
- **CUMULUS-2695**
  - Updates the example/cumulus-tf deployment to change
    `archive_api_reserved_concurrency` from 8 to 5 to use fewer reserved lambda
    functions. If you see throttling errors on the `<stack>-apiEndpoints` you
    should increase this value.
  - Updates cumulus-tf/cumulus/variables.tf to change
    `archive_api_reserved_concurrency` from 8 to 15 to prevent throttling on
    the dashboard for default deployments.
- **CUMULUS-2584**
  - Updates `api/endpoints/execution-status.js` `get` method to include associated granules, as
    an array, for the provided execution.
  - Added `getExecutionArnsByGranuleCumulusId` returning a list of executionArns sorted by most recent first,
    for an input Granule Cumulus ID in support of the move of `translatePostgresGranuleToApiGranule` from RDS-Phase2
    feature branch
  - Added `getApiExecutionCumulusIds` returning cumulus IDs for a given list of executions
- **CUMULUS-NONE**
  - Downgrades elasticsearch version in testing container to 5.3 to match AWS version.
  - Update serve.js -> `eraseDynamoTables()`. Changed the call `Promise.all()` to `Promise.allSettled()` to ensure all dynamo records (provider records in particular) are deleted prior to reseeding.

### Fixed

- **CUMULUS-2583**
  - Fixed a race condition where granules set as “queued” were not able to be set as “running” or “completed”

## [v9.6.0] 2021-09-20

### Added

- **CUMULUS-2576**
  - Adds `PUT /granules` API endpoint to update a granule
  - Adds helper `updateGranule` to `@cumulus/api-client/granules`
- **CUMULUS-2606**
  - Adds `POST /granules/{granuleId}/executions` API endpoint to associate an execution with a granule
  - Adds helper `associateExecutionWithGranule` to `@cumulus/api-client/granules`
- **CUMULUS-2583**
  - Adds `queued` as option for granule's `status` field

### Changed

- Moved `ssh2` package from `@cumulus/common` to `@cumulus/sftp-client` and
  upgraded package from `^0.8.7` to `^1.0.0` to address security vulnerability
  issue in previous version.
- **CUMULUS-2583**
  - `QueueGranules` task now updates granule status to `queued` once it is added to the queue.

- **CUMULUS-2617**
  - Use the `Authorization` header for CMR Launchpad authentication instead of the deprecated `Echo-Token` header.

### Fixed

- Added missing permission for `<prefix>_ecs_cluster_instance_role` IAM role (used when running ECS services/tasks)
to allow `kms:Decrypt` on the KMS key used to encrypt provider credentials. Adding this permission fixes the `sync-granule` task when run as an ECS activity in a Step Function, which previously failed trying to decrypt credentials for providers.

- **CUMULUS-2576**
  - Adds default value to granule's timestamp when updating a granule via API.

## [v9.5.0] 2021-09-07

### BREAKING CHANGES

- Removed `logs` record type from mappings from Elasticsearch. This change **should not have**
any adverse impact on existing deployments, even those which still contain `logs` records,
but technically it is a breaking change to the Elasticsearch mappings.
- Changed `@cumulus/api-client/asyncOperations.getAsyncOperation` to return parsed JSON body
of response and not the raw API endpoint response

### Added

- **CUMULUS-2670**
  - Updated core `cumulus` module to take lambda_timeouts string map variable that allows timeouts of ingest tasks to be configurable. Allowed properties for the mapping include:
  - discover_granules_task_timeout
  - discover_pdrs_task_timeout
  - hyrax_metadata_update_tasks_timeout
  - lzards_backup_task_timeout
  - move_granules_task_timeout
  - parse_pdr_task_timeout
  - pdr_status_check_task_timeout
  - post_to_cmr_task_timeout
  - queue_granules_task_timeout
  - queue_pdrs_task_timeout
  - queue_workflow_task_timeout
  - sync_granule_task_timeout
- **CUMULUS-2575**
  - Adds `POST /granules` API endpoint to create a granule
  - Adds helper `createGranule` to `@cumulus/api-client`
- **CUMULUS-2577**
  - Adds `POST /executions` endpoint to create an execution
- **CUMULUS-2578**
  - Adds `PUT /executions` endpoint to update an execution
- **CUMULUS-2592**
  - Adds logging when messages fail to be added to queue
- **CUMULUS-2644**
  - Pulled `delete` method for `granules-executions.ts` implemented as part of CUMULUS-2306
  from the RDS-Phase-2 feature branch in support of CUMULUS-2644.
  - Pulled `erasePostgresTables` method in `serve.js` implemented as part of CUMULUS-2644,
  and CUMULUS-2306 from the RDS-Phase-2 feature branch in support of CUMULUS-2644
  - Added `resetPostgresDb` method to support resetting between integration test suite runs

### Changed

- Updated `processDeadLetterArchive` Lambda to return an object where
`processingSucceededKeys` is an array of the S3 keys for successfully
processed objects and `processingFailedKeys` is an array of S3 keys
for objects that could not be processed
- Updated async operations to handle writing records to the databases
when output of the operation is `undefined`

- **CUMULUS-2644**
  - Moved `migration` directory from the `db-migration-lambda` to the `db` package and
  updated unit test references to migrationDir to be pulled from `@cumulus/db`
  - Updated `@cumulus/api/bin/serveUtils` to write records to PostgreSQL tables

- **CUMULUS-2575**
  - Updates model/granule to allow a granule created from API to not require an
    execution to be associated with it. This is a backwards compatible change
    that will not affect granules created in the normal way.
  - Updates `@cumulus/db/src/model/granules` functions `get` and `exists` to
    enforce parameter checking so that requests include either (granule\_id
    and collection\_cumulus\_id) or (cumulus\_id) to prevent incorrect results.
  - `@cumulus/message/src/Collections.deconstructCollectionId` has been
    modified to throw a descriptive error if the input `collectionId` is
    undefined rather than `TypeError: Cannot read property 'split' of
    undefined`. This function has also been updated to throw descriptive errors
    if an incorrectly formatted collectionId is input.

## [v9.4.1] 2022-02-14 [BACKPORT]

**Please note** changes in 9.4.1 may not yet be released in future versions, as
this is a backport and patch release on the 9.4.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

- **CUMULUS-2847**
  - Update dynamo configuration to read from S3 instead of System Manager
    Parameter Store
  - Move api configuration initialization outside the lambda handler to
    eliminate unneded S3 calls/require config on cold-start only
  - Moved `ssh2` package from `@cumulus/common` to `@cumulus/sftp-client` and
    upgraded package from `^0.8.7` to `^1.0.0` to address security vulnerability
    issue in previous version.
  - Fixed hyrax task package.json dev dependency
  - Update CNM lambda dependencies for Core tasks
    - cumulus-cnm-response-task: 1.4.4
    - cumulus-cnm-to-granule: 1.5.4
  - Whitelist ssh2 re: https://github.com/advisories/GHSA-652h-xwhf-q4h6

## [v9.4.0] 2021-08-16

### Notable changes

- `@cumulus/sync-granule` task should now properly handle
syncing files from HTTP/HTTPS providers where basic auth is
required and involves a redirect to a different host (e.g.
downloading files protected by Earthdata Login)

### Added

- **CUMULUS-2591**
  - Adds `failedExecutionStepName` to failed execution's jsonb error records.
    This is the name of the Step Function step for the last failed event in the
    execution's event history.
- **CUMULUS-2548**
  - Added `allowed_redirects` field to PostgreSQL `providers` table
  - Added `allowedRedirects` field to DynamoDB `<prefix>-providers` table
  - Added `@cumulus/aws-client/S3.streamS3Upload` to handle uploading the contents
  of a readable stream to S3 and returning a promise
- **CUMULUS-2373**
  - Added `replaySqsMessages` lambda to replay archived incoming SQS
    messages from S3.
  - Added `/replays/sqs` endpoint to trigger an async operation for
    the `replaySqsMessages` lambda.
  - Added unit tests and integration tests for new endpoint and lambda.
  - Added `getS3PrefixForArchivedMessage` to `ingest/sqs` package to get prefix
    for an archived message.
  - Added new `async_operation` type `SQS Replay`.
- **CUMULUS-2460**
  - Adds `POST` /executions/workflows-by-granules for retrieving workflow names common to a set of granules
  - Adds `workflowsByGranules` to `@cumulus/api-client/executions`
- **CUMULUS-2635**
  - Added helper functions:
    - `@cumulus/db/translate/file/translateApiPdrToPostgresPdr`

### Fixed

- **CUMULUS-2548**
  - Fixed `@cumulus/ingest/HttpProviderClient.sync` to
properly handle basic auth when redirecting to a different
host and/or host with a different port
- **CUMULUS-2626**
  - Update [PDR migration](https://github.com/nasa/cumulus/blob/master/lambdas/data-migration2/src/pdrs.ts) to correctly find Executions by a Dynamo PDR's `execution` field
- **CUMULUS-2635**
  - Update `data-migration2` to migrate PDRs before migrating granules.
  - Update `data-migration2` unit tests testing granules migration to reference
    PDR records to better model the DB schema.
  - Update `migratePdrRecord` to use `translateApiPdrToPostgresPdr` function.

### Changed

- **CUMULUS-2373**
  - Updated `getS3KeyForArchivedMessage` in `ingest/sqs` to store SQS messages
    by `queueName`.
- **CUMULUS-2630**
  - Updates the example/cumulus-tf deployment to change
    `archive_api_reserved_concurrency` from 2 to 8 to prevent throttling with
    the dashboard.

## [v9.3.0] 2021-07-26

### BREAKING CHANGES

- All API requests made by `@cumulus/api-client` will now throw an error if the status code
does not match the expected response (200 for most requests and 202 for a few requests that
trigger async operations). Previously the helpers in this package would return the response
regardless of the status code, so you may need to update any code using helpers from this
package to catch or to otherwise handle errors that you may encounter.
- The Cumulus API Lambda function has now been configured with reserved concurrency to ensure
availability in a high-concurrency environment. However, this also caps max concurrency which
may result in throttling errors if trying to reach the Cumulus API multiple times in a short
period. Reserved concurrency can be configured with the `archive_api_reserved_concurrency`
terraform variable on the Cumulus module and increased if you are seeing throttling errors.
The default reserved concurrency value is 8.

### Notable changes

- `cmr_custom_host` variable for `cumulus` module can now be used to configure Cumulus to
  integrate with a custom CMR host name and protocol (e.g.
  `http://custom-cmr-host.com`). Note that you **must** include a protocol
  (`http://` or `https://)  if specifying a value for this variable.
- The cumulus module configuration value`rds_connetion_heartbeat` and it's
  behavior has been replaced by a more robust database connection 'retry'
  solution.   Users can remove this value from their configuration, regardless
  of value.  See the `Changed` section notes on CUMULUS-2528 for more details.

### Added

- Added user doc describing new features related to the Cumulus dead letter archive.
- **CUMULUS-2327**
  - Added reserved concurrency setting to the Cumulus API lambda function.
  - Added relevant tfvars to the archive and cumulus terraform modules.
- **CUMULUS-2460**
  - Adds `POST` /executions/search-by-granules for retrieving executions from a list of granules or granule query
  - Adds `searchExecutionsByGranules` to `@cumulus/api-client/executions`
- **CUMULUS-2475**
  - Adds `GET` endpoint to distribution API
- **CUMULUS-2463**
  - `PUT /granules` reingest action allows a user to override the default execution
    to use by providing an optional `workflowName` or `executionArn` parameter on
    the request body.
  - `PUT /granules/bulkReingest` action allows a user to override the default
    execution/workflow combination to reingest with by providing an optional
    `workflowName` on the request body.
- Adds `workflowName` and `executionArn` params to @cumulus/api-client/reingestGranules
- **CUMULUS-2476**
  - Adds handler for authenticated `HEAD` Distribution requests replicating current behavior of TEA
- **CUMULUS-2478**
  - Implemented [bucket map](https://github.com/asfadmin/thin-egress-app#bucket-mapping).
  - Implemented /locate endpoint
  - Cumulus distribution API checks the file request against bucket map:
    - retrieves the bucket and key from file path
    - determines if the file request is public based on the bucket map rather than the bucket type
    - (EDL only) restricts download from PRIVATE_BUCKETS to users who belong to certain EDL User Groups
    - bucket prefix and object prefix are supported
  - Add 'Bearer token' support as an authorization method
- **CUMULUS-2486**
  - Implemented support for custom headers
  - Added 'Bearer token' support as an authorization method
- **CUMULUS-2487**
  - Added integration test for cumulus distribution API
- **CUMULUS-2569**
  - Created bucket map cache for cumulus distribution API
- **CUMULUS-2568**
  - Add `deletePdr`/PDR deletion functionality to `@cumulus/api-client/pdrs`
  - Add `removeCollectionAndAllDependencies` to integration test helpers
  - Added `example/spec/apiUtils.waitForApiStatus` to wait for a
  record to be returned by the API with a specific value for
  `status`
  - Added `example/spec/discoverUtils.uploadS3GranuleDataForDiscovery` to upload granule data fixtures
  to S3 with a randomized granule ID for `discover-granules` based
  integration tests
  - Added `example/spec/Collections.removeCollectionAndAllDependencies` to remove a collection and
  all dependent objects (e.g. PDRs, granules, executions) from the
  database via the API
  - Added helpers to `@cumulus/api-client`:
    - `pdrs.deletePdr` - Delete a PDR via the API
    - `replays.postKinesisReplays` - Submit a POST request to the `/replays` endpoint for replaying Kinesis messages

- `@cumulus/api-client/granules.getGranuleResponse` to return the raw endpoint response from the GET `/granules/<granuleId>` endpoint

### Changed

- Moved functions from `@cumulus/integration-tests` to `example/spec/helpers/workflowUtils`:
  - `startWorkflowExecution`
  - `startWorkflow`
  - `executeWorkflow`
  - `buildWorkflow`
  - `testWorkflow`
  - `buildAndExecuteWorkflow`
  - `buildAndStartWorkflow`
- `example/spec/helpers/workflowUtils.executeWorkflow` now uses
`waitForApiStatus` to ensure that the execution is `completed` or
`failed` before resolving
- `example/spec/helpers/testUtils.updateAndUploadTestFileToBucket`
now accepts an object of parameters rather than positional
arguments
- Removed PDR from the `payload` in the input payload test fixture for reconciliation report integration tests
- The following integration tests for PDR-based workflows were
updated to use randomized granule IDs:
  - `example/spec/parallel/ingest/ingestFromPdrSpec.js`
  - `example/spec/parallel/ingest/ingestFromPdrWithChildWorkflowMetaSpec.js`
  - `example/spec/parallel/ingest/ingestFromPdrWithExecutionNamePrefixSpec.js`
  - `example/spec/parallel/ingest/ingestPdrWithNodeNameSpec.js`
- Updated the `@cumulus/api-client/CumulusApiClientError` error class to include new properties that can be accessed directly on
the error object:
  - `statusCode` - The HTTP status code of the API response
  - `apiMessage` - The message from the API response
- Added `params.pRetryOptions` parameter to
`@cumulus/api-client/granules.deleteGranule` to control the retry
behavior
- Updated `cmr_custom_host` variable to accept a full protocol and host name
(e.g. `http://cmr-custom-host.com`), whereas it previously only accepted a host name
- **CUMULUS-2482**
  - Switches the default distribution app in the `example/cumulus-tf` deployment to the new Cumulus Distribution
  - TEA is still available by following instructions in `example/README.md`
- **CUMULUS-2463**
  - Increases the duration of allowed backoff times for a successful test from
    0.5 sec to 1 sec.
- **CUMULUS-2528**
  - Removed `rds_connection_heartbeat` as a configuration option from all
    Cumulus terraform modules
  - Removed `dbHeartBeat` as an environmental switch from
    `@cumulus/db.getKnexClient` in favor of more comprehensive general db
    connect retry solution
  - Added new `rds_connection_timing_configuration` string map to allow for
    configuration and tuning of Core's internal database retry/connection
    timeout behaviors.  These values map to connection pool configuration
    values for tarn (https://github.com/vincit/tarn.js/) which Core's database
    module / knex(https://www.npmjs.com/package/knex) use for this purpose:
    - acquireTimeoutMillis
    - createRetryIntervalMillis
    - createTimeoutMillis
    - idleTimeoutMillis
    - reapIntervalMillis
      Connection errors will result in a log line prepended with 'knex failed on
      attempted connection error' and sent from '@cumulus/db/connection'
  - Updated `@cumulus/db` and all terraform mdules to set default retry
    configuration values for the database module to cover existing database
    heartbeat connection failures as well as all other knex/tarn connection
    creation failures.

### Fixed

- Fixed bug where `cmr_custom_host` variable was not properly forwarded into `archive`, `ingest`, and `sqs-message-remover` modules from `cumulus` module
- Fixed bug where `parse-pdr` set a granule's provider to the entire provider record when a `NODE_NAME`
  is present. Expected behavior consistent with other tasks is to set the provider name in that field.
- **CUMULUS-2568**
  - Update reconciliation report integration test to have better cleanup/failure behavior
  - Fixed `@cumulus/api-client/pdrs.getPdr` to request correct endpoint for returning a PDR from the API
- **CUMULUS-2620**
  - Fixed a bug where a granule could be removed from CMR but still be set as
  `published: true` and with a CMR link in the Dynamo/PostgreSQL databases. Now,
  the CMR deletion and the Dynamo/PostgreSQL record updates will all succeed or fail
  together, preventing the database records from being out of sync with CMR.
  - Fixed `@cumulus/api-client/pdrs.getPdr` to request correct
  endpoint for returning a PDR from the API

## [v9.2.2] 2021-08-06 - [BACKPORT]

**Please note** changes in 9.2.2 may not yet be released in future versions, as
this is a backport and patch release on the 9.2.x series of releases. Updates that
are included in the future will have a corresponding CHANGELOG entry in future
releases.

### Added

- **CUMULUS-2635**
  - Added helper functions:
    - `@cumulus/db/translate/file/translateApiPdrToPostgresPdr`

### Fixed

- **CUMULUS-2635**
  - Update `data-migration2` to migrate PDRs before migrating granules.
  - Update `data-migration2` unit tests testing granules migration to reference
    PDR records to better model the DB schema.
  - Update `migratePdrRecord` to use `translateApiPdrToPostgresPdr` function.

## [v9.2.1] 2021-07-29 - [BACKPORT]

### Fixed

- **CUMULUS-2626**
  - Update [PDR migration](https://github.com/nasa/cumulus/blob/master/lambdas/data-migration2/src/pdrs.ts) to correctly find Executions by a Dynamo PDR's `execution` field

## [v9.2.0] 2021-06-22

### Added

- **CUMULUS-2475**
  - Adds `GET` endpoint to distribution API
- **CUMULUS-2476**
  - Adds handler for authenticated `HEAD` Distribution requests replicating current behavior of TEA

### Changed

- **CUMULUS-2482**
  - Switches the default distribution app in the `example/cumulus-tf` deployment to the new Cumulus Distribution
  - TEA is still available by following instructions in `example/README.md`

### Fixed

- **CUMULUS-2520**
  - Fixed error that prevented `/elasticsearch/index-from-database` from starting.
- **CUMULUS-2558**
  - Fixed issue where executions original_payload would not be retained on successful execution

## [v9.1.0] 2021-06-03

### BREAKING CHANGES

- @cumulus/api-client/granules.getGranule now returns the granule record from the GET /granules/<granuleId> endpoint, not the raw endpoint response
- **CUMULUS-2434**
  - To use the updated `update-granules-cmr-metadata-file-links` task, the
    granule  UMM-G metadata should have version 1.6.2 or later, since CMR s3
    link type 'GET DATA VIA DIRECT ACCESS' is not valid until UMM-G version
    [1.6.2](https://cdn.earthdata.nasa.gov/umm/granule/v1.6.2/umm-g-json-schema.json)
- **CUMULUS-2488**
  - Removed all EMS reporting including lambdas, endpoints, params, etc as all
    reporting is now handled through Cloud Metrics
- **CUMULUS-2472**
  - Moved existing `EarthdataLoginClient` to
    `@cumulus/oauth-client/EarthdataLoginClient` and updated all references in
    Cumulus Core.
  - Rename `EarthdataLoginClient` property from `earthdataLoginUrl` to
    `loginUrl for consistency with new OAuth clients. See example in
    [oauth-client
    README](https://github.com/nasa/cumulus/blob/master/packages/oauth-client/README.md)

### Added

- **HYRAX-439** - Corrected README.md according to a new Hyrax URL format.
- **CUMULUS-2354**
  - Adds configuration options to allow `/s3credentials` endpoint to distribute
    same-region read-only tokens based on a user's CMR ACLs.
  - Configures the example deployment to enable this feature.
- **CUMULUS-2442**
  - Adds option to generate cloudfront URL to lzards-backup task. This will require a few new task config options that have been documented in the [task README](https://github.com/nasa/cumulus/blob/master/tasks/lzards-backup/README.md).
- **CUMULUS-2470**
  - Added `/s3credentials` endpoint for distribution API
- **CUMULUS-2471**
  - Add `/s3credentialsREADME` endpoint to distribution API
- **CUMULUS-2473**
  - Updated `tf-modules/cumulus_distribution` module to take earthdata or cognito credentials
  - Configured `example/cumulus-tf/cumulus_distribution.tf` to use CSDAP credentials
- **CUMULUS-2474**
  - Add `S3ObjectStore` to `aws-client`. This class allows for interaction with the S3 object store.
  - Add `object-store` package which contains abstracted object store functions for working with various cloud providers
- **CUMULUS-2477**
  - Added `/`, `/login` and `/logout` endpoints to cumulus distribution api
- **CUMULUS-2479**
  - Adds /version endpoint to distribution API
- **CUMULUS-2497**
  - Created `isISOFile()` to check if a CMR file is a CMR ISO file.
- **CUMULUS-2371**
  - Added helpers to `@cumulus/ingest/sqs`:
    - `archiveSqsMessageToS3` - archives an incoming SQS message to S3
    - `deleteArchivedMessageFromS3` - deletes a processed SQS message from S3
  - Added call to `archiveSqsMessageToS3` to `sqs-message-consumer` which
    archives all incoming SQS messages to S3.
  - Added call to `deleteArchivedMessageFrom` to `sqs-message-remover` which
    deletes archived SQS message from S3 once it has been processed.

### Changed

- **[PR2224](https://github.com/nasa/cumulus/pull/2244)**
- **CUMULUS-2208**
  - Moved all `@cumulus/api/es/*` code to new `@cumulus/es-client` package
- Changed timeout on `sfEventSqsToDbRecords` Lambda to 60 seconds to match
  timeout for Knex library to acquire database connections
- **CUMULUS-2517**
  - Updated postgres-migration-count-tool default concurrency to '1'
- **CUMULUS-2489**
  - Updated docs for Terraform references in FAQs, glossary, and in Deployment sections
- **CUMULUS-2434**
  - Updated `@cumulus/cmrjs` `updateCMRMetadata` and related functions to add
    both HTTPS URLS and S3 URIs to CMR metadata.
  - Updated `update-granules-cmr-metadata-file-links` task to add both HTTPS
    URLs and S3 URIs to the OnlineAccessURLs field of CMR metadata. The task
    configuration parameter `cmrGranuleUrlType` now has default value `both`.
  - To use the updated `update-granules-cmr-metadata-file-links` task, the
    granule UMM-G metadata should have version 1.6.2 or later, since CMR s3 link
    type 'GET DATA VIA DIRECT ACCESS' is not valid until UMM-G version
    [1.6.2](https://cdn.earthdata.nasa.gov/umm/granule/v1.6.2/umm-g-json-schema.json)
- **CUMULUS-2472**
  - Renamed `@cumulus/earthdata-login-client` to more generic
    `@cumulus/oauth-client` as a parent  class for new OAuth clients.
  - Added `@cumulus/oauth-client/CognitoClient` to interface with AWS cognito login service.
- **CUMULUS-2497**
  - Changed the `@cumulus/cmrjs` package:
    - Updated `@cumulus/cmrjs/cmr-utils.getGranuleTemporalInfo()` so it now
      returns temporal info for CMR ISO 19115 SMAP XML files.
    - Updated `@cumulus/cmrjs/cmr-utils.isCmrFilename()` to include
      `isISOFile()`.
- **CUMULUS-2532**
  - Changed integration tests to use `api-client/granules` functions as opposed to granulesApi from `@cumulus/integration-tests`.

### Fixed

- **CUMULUS-2519**
  - Update @cumulus/integration-tests.buildWorkflow to fail if provider/collection API response is not successful
- **CUMULUS-2518**
  - Update sf-event-sqs-to-db-records to not throw if a collection is not
    defined on a payload that has no granules/an empty granule payload object
- **CUMULUS-2512**
  - Updated ingest package S3 provider client to take additional parameter
    `remoteAltBucket` on `download` method to allow for per-file override of
    provider bucket for checksum
  - Updated @cumulus/ingest.fetchTextFile's signature to be parameterized and
    added `remoteAltBucket`to allow for an override of the passed in provider
    bucket for the source file
  - Update "eslint-plugin-import" to be pinned to 2.22.1
- **CUMULUS-2520**
  - Fixed error that prevented `/elasticsearch/index-from-database` from starting.
- **CUMULUS-2532**
  - Fixed integration tests to have granule deletion occur before provider and
    collection deletion in test cleanup.
- **[2231](https://github.com/nasa/cumulus/issues/2231)**
  - Fixes broken relative path links in `docs/README.md`

### Removed

- **CUMULUS-2502**
  - Removed outdated documentation regarding Kibana index patterns for metrics.

## [v9.0.1] 2021-05-07

### Migration Steps

Please review the migration steps for 9.0.0 as this release is only a patch to
correct a failure in our build script and push out corrected release artifacts. The previous migration steps still apply.

### Changed

- Corrected `@cumulus/db` configuration to correctly build package.

## [v9.0.0] 2021-05-03

### Migration steps

- This release of Cumulus enables integration with a PostgreSQL database for archiving Cumulus data. There are several upgrade steps involved, **some of which need to be done before redeploying Cumulus**. See the [documentation on upgrading to the RDS release](https://nasa.github.io/cumulus/docs/upgrade-notes/upgrade-rds).

### BREAKING CHANGES

- **CUMULUS-2185** - RDS Migration Epic
  - **CUMULUS-2191**
    - Removed the following from the `@cumulus/api/models.asyncOperation` class in
      favor of the added `@cumulus/async-operations` module:
      - `start`
      - `startAsyncOperations`
  - **CUMULUS-2187**
    - The `async-operations` endpoint will now omit `output` instead of
      returning `none` when the operation did not return output.
  - **CUMULUS-2309**
    - Removed `@cumulus/api/models/granule.unpublishAndDeleteGranule` in favor
      of `@cumulus/api/lib/granule-remove-from-cmr.unpublishGranule` and
      `@cumulus/api/lib/granule-delete.deleteGranuleAndFiles`.
  - **CUMULUS-2385**
    - Updated `sf-event-sqs-to-db-records` to write a granule's files to
      PostgreSQL only after the workflow has exited the `Running` status.
      Please note that any workflow that uses `sf_sqs_report_task` for
      mid-workflow updates will be impacted.
    - Changed PostgreSQL `file` schema and TypeScript type definition to require
      `bucket` and `key` fields.
    - Updated granule/file write logic to mark a granule's status as "failed"
  - **CUMULUS-2455**
    - API `move granule` endpoint now moves granule files on a per-file basis
    - API `move granule` endpoint on granule file move failure will retain the
      file at it's original location, but continue to move any other granule
      files.
    - Removed the `move` method from the `@cumulus/api/models.granule` class.
      logic is now handled in `@cumulus/api/endpoints/granules` and is
      accessible via the Core API.

### Added

- **CUMULUS-2185** - RDS Migration Epic
  - **CUMULUS-2130**
    - Added postgres-migration-count-tool lambda/ECS task to allow for
      evaluation of database state
    - Added /migrationCounts api endpoint that allows running of the
      postgres-migration-count-tool as an asyncOperation
  - **CUMULUS-2394**
    - Updated PDR and Granule writes to check the step function
      workflow_start_time against the createdAt field for each record to ensure
      old records do not overwrite newer ones for legacy Dynamo and PostgreSQL
      writes
  - **CUMULUS-2188**
    - Added `data-migration2` Lambda to be run after `data-migration1`
    - Added logic to `data-migration2` Lambda for migrating execution records
      from DynamoDB to PostgreSQL
  - **CUMULUS-2191**
    - Added `@cumulus/async-operations` to core packages, exposing
      `startAsyncOperation` which will handle starting an async operation and
      adding an entry to both PostgreSQL and DynamoDb
  - **CUMULUS-2127**
    - Add schema migration for `collections` table
  - **CUMULUS-2129**
    - Added logic to `data-migration1` Lambda for migrating collection records
      from Dynamo to PostgreSQL
  - **CUMULUS-2157**
    - Add schema migration for `providers` table
    - Added logic to `data-migration1` Lambda for migrating provider records
      from Dynamo to PostgreSQL
  - **CUMULUS-2187**
    - Added logic to `data-migration1` Lambda for migrating async operation
      records from Dynamo to PostgreSQL
  - **CUMULUS-2198**
    - Added logic to `data-migration1` Lambda for migrating rule records from
      DynamoDB to PostgreSQL
  - **CUMULUS-2182**
    - Add schema migration for PDRs table
  - **CUMULUS-2230**
    - Add schema migration for `rules` table
  - **CUMULUS-2183**
    - Add schema migration for `asyncOperations` table
  - **CUMULUS-2184**
    - Add schema migration for `executions` table
  - **CUMULUS-2257**
    - Updated PostgreSQL table and column names to snake_case
    - Added `translateApiAsyncOperationToPostgresAsyncOperation` function to `@cumulus/db`
  - **CUMULUS-2186**
    - Added logic to `data-migration2` Lambda for migrating PDR records from
      DynamoDB to PostgreSQL
  - **CUMULUS-2235**
    - Added initial ingest load spec test/utility
  - **CUMULUS-2167**
    - Added logic to `data-migration2` Lambda for migrating Granule records from
      DynamoDB to PostgreSQL and parse Granule records to store File records in
      RDS.
  - **CUMULUS-2367**
    - Added `granules_executions` table to PostgreSQL schema to allow for a
      many-to-many relationship between granules and executions
      - The table refers to granule and execution records using foreign keys
        defined with ON CASCADE DELETE, which means that any time a granule or
        execution record is deleted, all of the records in the
        `granules_executions` table referring to that record will also be
        deleted.
    - Added `upsertGranuleWithExecutionJoinRecord` helper to `@cumulus/db` to
      allow for upserting a granule record and its corresponding
      `granules_execution` record
  - **CUMULUS-2128**
    - Added helper functions:
      - `@cumulus/db/translate/file/translateApiFiletoPostgresFile`
      - `@cumulus/db/translate/file/translateApiGranuletoPostgresGranule`
      - `@cumulus/message/Providers/getMessageProvider`
  - **CUMULUS-2190**
    - Added helper functions:
      - `@cumulus/message/Executions/getMessageExecutionOriginalPayload`
      - `@cumulus/message/Executions/getMessageExecutionFinalPayload`
      - `@cumulus/message/workflows/getMessageWorkflowTasks`
      - `@cumulus/message/workflows/getMessageWorkflowStartTime`
      - `@cumulus/message/workflows/getMessageWorkflowStopTime`
      - `@cumulus/message/workflows/getMessageWorkflowName`
  - **CUMULUS-2192**
    - Added helper functions:
      - `@cumulus/message/PDRs/getMessagePdrRunningExecutions`
      - `@cumulus/message/PDRs/getMessagePdrCompletedExecutions`
      - `@cumulus/message/PDRs/getMessagePdrFailedExecutions`
      - `@cumulus/message/PDRs/getMessagePdrStats`
      - `@cumulus/message/PDRs/getPdrPercentCompletion`
      - `@cumulus/message/workflows/getWorkflowDuration`
  - **CUMULUS-2199**
    - Added `translateApiRuleToPostgresRule` to `@cumulus/db` to translate API
      Rule to conform to Postgres Rule definition.
  - **CUMUlUS-2128**
    - Added "upsert" logic to the `sfEventSqsToDbRecords` Lambda for granule and
      file writes to the core PostgreSQL database
  - **CUMULUS-2199**
    - Updated Rules endpoint to write rules to core PostgreSQL database in
      addition to DynamoDB and to delete rules from the PostgreSQL database in
      addition to DynamoDB.
    - Updated `create` in Rules Model to take in optional `createdAt` parameter
      which sets the value of createdAt if not specified during function call.
  - **CUMULUS-2189**
    - Updated Provider endpoint logic to write providers in parallel to Core
      PostgreSQL database
    - Update integration tests to utilize API calls instead of direct
      api/model/Provider calls
  - **CUMULUS-2191**
    - Updated cumuluss/async-operation task to write async-operations to the
      PostgreSQL database.
  - **CUMULUS-2228**
    - Added logic to the `sfEventSqsToDbRecords` Lambda to write execution, PDR,
      and granule records to the core PostgreSQL database in parallel with
      writes to DynamoDB
  - **CUMUlUS-2190**
    - Added "upsert" logic to the `sfEventSqsToDbRecords` Lambda for PDR writes
      to the core PostgreSQL database
  - **CUMUlUS-2192**
    - Added "upsert" logic to the `sfEventSqsToDbRecords` Lambda for execution
      writes to the core PostgreSQL database
  - **CUMULUS-2187**
    - The `async-operations` endpoint will now omit `output` instead of
      returning `none` when the operation did not return output.
  - **CUMULUS-2167**
    - Change PostgreSQL schema definition for `files` to remove `filename` and
      `name` and only support `file_name`.
    - Change PostgreSQL schema definition for `files` to remove `size` to only
      support `file_size`.
    - Change `PostgresFile` to remove duplicate fields `filename` and `name` and
      rename `size` to `file_size`.
  - **CUMULUS-2266**
    - Change `sf-event-sqs-to-db-records` behavior to discard and not throw an
      error on an out-of-order/delayed message so as not to have it be sent to
      the DLQ.
  - **CUMULUS-2305**
    - Changed `DELETE /pdrs/{pdrname}` API behavior to also delete record from
      PostgreSQL database.
  - **CUMULUS-2309**
    - Changed `DELETE /granules/{granuleName}` API behavior to also delete
      record from PostgreSQL database.
    - Changed `Bulk operation BULK_GRANULE_DELETE` API behavior to also delete
      records from PostgreSQL database.
  - **CUMULUS-2367**
    - Updated `granule_cumulus_id` foreign key to granule in PostgreSQL `files`
      table to use a CASCADE delete, so records in the files table are
      automatically deleted by the database when the corresponding granule is
      deleted.
  - **CUMULUS-2407**
    - Updated data-migration1 and data-migration2 Lambdas to use UPSERT instead
      of UPDATE when migrating dynamoDB records to PostgreSQL.
    - Changed data-migration1 and data-migration2 logic to only update already
      migrated records if the incoming record update has a newer timestamp
  - **CUMULUS-2329**
    - Add `write-db-dlq-records-to-s3` lambda.
    - Add terraform config to automatically write db records DLQ messages to an
      s3 archive on the system bucket.
    - Add unit tests and a component spec test for the above.
  - **CUMULUS-2380**
    - Add `process-dead-letter-archive` lambda to pick up and process dead letters in the S3 system bucket dead letter archive.
    - Add `/deadLetterArchive/recoverCumulusMessages` endpoint to trigger an async operation to leverage this capability on demand.
    - Add unit tests and integration test for all of the above.
  - **CUMULUS-2406**
    - Updated parallel write logic to ensure that updatedAt/updated_at
      timestamps are the same in Dynamo/PG on record write for the following
      data types:
      - async operations
      - granules
      - executions
      - PDRs
  - **CUMULUS-2446**
    - Remove schema validation check against DynamoDB table for collections when
      migrating records from DynamoDB to core PostgreSQL database.
  - **CUMULUS-2447**
    - Changed `translateApiAsyncOperationToPostgresAsyncOperation` to call
      `JSON.stringify` and then `JSON.parse` on output.
  - **CUMULUS-2313**
    - Added `postgres-migration-async-operation` lambda to start an ECS task to
      run a the `data-migration2` lambda.
    - Updated `async_operations` table to include `Data Migration 2` as a new
      `operation_type`.
    - Updated `cumulus-tf/variables.tf` to include `optional_dynamo_tables` that
      will be merged with `dynamo_tables`.
  - **CUMULUS-2451**
    - Added summary type file `packages/db/src/types/summary.ts` with
      `MigrationSummary` and `DataMigration1` and `DataMigration2` types.
    - Updated `data-migration1` and `data-migration2` lambdas to return
      `MigrationSummary` objects.
    - Added logging for every batch of 100 records processed for executions,
      granules and files, and PDRs.
    - Removed `RecordAlreadyMigrated` logs in `data-migration1` and
      `data-migration2`
  - **CUMULUS-2452**
    - Added support for only migrating certain granules by specifying the
      `granuleSearchParams.granuleId` or `granuleSearchParams.collectionId`
      properties in the payload for the
      `<prefix>-postgres-migration-async-operation` Lambda
    - Added support for only running certain migrations for data-migration2 by
      specifying the `migrationsList` property in the payload for the
      `<prefix>-postgres-migration-async-operation` Lambda
  - **CUMULUS-2453**
    - Created `storeErrors` function which stores errors in system bucket.
    - Updated `executions` and `granulesAndFiles` data migrations to call `storeErrors` to store migration errors.
    - Added `system_bucket` variable to `data-migration2`.
  - **CUMULUS-2455**
    - Move granules API endpoint records move updates for migrated granule files
      if writing any of the granule files fails.
  - **CUMULUS-2468**
    - Added support for doing [DynamoDB parallel scanning](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan) for `executions` and `granules` migrations to improve performance. The behavior of the parallel scanning and writes can be controlled via the following properties on the event input to the `<prefix>-postgres-migration-async-operation` Lambda:
      - `granuleMigrationParams.parallelScanSegments`: How many segments to divide your granules DynamoDB table into for parallel scanning
      - `granuleMigrationParams.parallelScanLimit`: The maximum number of granule records to evaluate for each parallel scanning segment of the DynamoDB table
      - `granuleMigrationParams.writeConcurrency`: The maximum number of concurrent granule/file writes to perform to the PostgreSQL database across all DynamoDB segments
      - `executionMigrationParams.parallelScanSegments`: How many segments to divide your executions DynamoDB table into for parallel scanning
      - `executionMigrationParams.parallelScanLimit`: The maximum number of execution records to evaluate for each parallel scanning segment of the DynamoDB table
      - `executionMigrationParams.writeConcurrency`: The maximum number of concurrent execution writes to perform to the PostgreSQL database across all DynamoDB segments
  - **CUMULUS-2468** - Added `@cumulus/aws-client/DynamoDb.parallelScan` helper to perform [parallel scanning on DynamoDb tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan)
  - **CUMULUS-2507**
    - Updated granule record write logic to set granule status to `failed` in both Postgres and DynamoDB if any/all of its files fail to write to the database.

### Deprecated

- **CUMULUS-2185** - RDS Migration Epic
  - **CUMULUS-2455**
    - `@cumulus/ingest/moveGranuleFiles`

## [v8.1.2] 2021-07-29

**Please note** changes in 8.1.2 may not yet be released in future versions, as this
is a backport/patch release on the 8.x series of releases.  Updates that are
included in the future will have a corresponding CHANGELOG entry in future releases.

### Notable changes

- `cmr_custom_host` variable for `cumulus` module can now be used to configure Cumulus to
integrate with a custom CMR host name and protocol (e.g. `http://custom-cmr-host.com`). Note
that you **must** include a protocol (`http://` or `https://`) if specifying a value for this
variable.
- `@cumulus/sync-granule` task should now properly handle
syncing files from HTTP/HTTPS providers where basic auth is
required and involves a redirect to a different host (e.g.
downloading files protected by Earthdata Login)

### Added

- **CUMULUS-2548**
  - Added `allowed_redirects` field to PostgreSQL `providers` table
  - Added `allowedRedirects` field to DynamoDB `<prefix>-providers` table
  - Added `@cumulus/aws-client/S3.streamS3Upload` to handle uploading the contents
  of a readable stream to S3 and returning a promise

### Changed

- Updated `cmr_custom_host` variable to accept a full protocol and host name
(e.g. `http://cmr-custom-host.com`), whereas it previously only accepted a host name

### Fixed

- Fixed bug where `cmr_custom_host` variable was not properly forwarded into `archive`, `ingest`, and `sqs-message-remover` modules from `cumulus` module
- **CUMULUS-2548**
  - Fixed `@cumulus/ingest/HttpProviderClient.sync` to
properly handle basic auth when redirecting to a different
host and/or host with a different port

## [v8.1.1] 2021-04-30 -- Patch Release

**Please note** changes in 8.1.1 may not yet be released in future versions, as this
is a backport/patch release on the 8.x series of releases.  Updates that are
included in the future will have a corresponding CHANGELOG entry in future releases.

### Added

- **CUMULUS-2497**
  - Created `isISOFile()` to check if a CMR file is a CMR ISO file.

### Fixed

- **CUMULUS-2512**
  - Updated ingest package S3 provider client to take additional parameter
    `remoteAltBucket` on `download` method to allow for per-file override of
    provider bucket for checksum
  - Updated @cumulus/ingest.fetchTextFile's signature to be parameterized and
    added `remoteAltBucket`to allow for an override of the passed in provider
    bucket for the source file
  - Update "eslint-plugin-import" to be pinned to 2.22.1

### Changed

- **CUMULUS-2497**
  - Changed the `@cumulus/cmrjs` package:
    - Updated `@cumulus/cmrjs/cmr-utils.getGranuleTemporalInfo()` so it now
      returns temporal info for CMR ISO 19115 SMAP XML files.
    - Updated `@cumulus/cmrjs/cmr-utils.isCmrFilename()` to include
      `isISOFile()`.

- **[2216](https://github.com/nasa/cumulus/issues/2216)**
  - Removed "node-forge", "xml-crypto" from audit whitelist, added "underscore"

## [v8.1.0] 2021-04-29

### Added

- **CUMULUS-2348**
  - The `@cumulus/api` `/granules` and `/granules/{granuleId}` endpoints now take `getRecoveryStatus` parameter
  to include recoveryStatus in result granule(s)
  - The `@cumulus/api-client.granules.getGranule` function takes a `query` parameter which can be used to
  request additional granule information.
  - Published `@cumulus/api@7.2.1-alpha.0` for dashboard testing
- **CUMULUS-2469**
  - Added `tf-modules/cumulus_distribution` module to standup a skeleton
    distribution api

## [v8.0.0] 2021-04-08

### BREAKING CHANGES

- **CUMULUS-2428**
  - Changed `/granules/bulk` to use `queueUrl` property instead of a `queueName` property for setting the queue to use for scheduling bulk granule workflows

### Notable changes

- Bulk granule operations endpoint now supports setting a custom queue for scheduling workflows via the `queueUrl` property in the request body. If provided, this value should be the full URL for an SQS queue.

### Added

- **CUMULUS-2374**
  - Add cookbok entry for queueing PostToCmr step
  - Add example workflow to go with cookbook
- **CUMULUS-2421**
  - Added **experimental** `ecs_include_docker_cleanup_cronjob` boolean variable to the Cumulus module to enable cron job to clean up docker root storage blocks in ECS cluster template for non-`device-mapper` storage drivers. Default value is `false`. This fulfills a specific user support request. This feature is otherwise untested and will remain so until we can iterate with a better, more general-purpose solution. Use of this feature is **NOT** recommended unless you are certain you need it.

- **CUMULUS-1808**
  - Add additional error messaging in `deleteSnsTrigger` to give users more context about where to look to resolve ResourceNotFound error when disabling or deleting a rule.

### Fixed

- **CUMULUS-2281**
  - Changed discover-granules task to write discovered granules directly to
    logger, instead of via environment variable. This fixes a problem where a
    large number of found granules prevents this lambda from running as an
    activity with an E2BIG error.

## [v7.2.0] 2021-03-23

### Added

- **CUMULUS-2346**
  - Added orca API endpoint to `@cumulus/api` to get recovery status
  - Add `CopyToGlacier` step to [example IngestAndPublishGranuleWithOrca workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_with_orca_workflow.tf)

### Changed

- **HYRAX-357**
  - Format of NGAP OPeNDAP URL changed and by default now is referring to concept id and optionally can include short name and version of collection.
  - `addShortnameAndVersionIdToConceptId` field has been added to the config inputs of the `hyrax-metadata-updates` task

## [v7.1.0] 2021-03-12

### Notable changes

- `sync-granule` task will now properly handle syncing 0 byte files to S3
- SQS/Kinesis rules now support scheduling workflows to a custom queue via the `rule.queueUrl` property. If provided, this value should be the full URL for an SQS queue.

### Added

- `tf-modules/cumulus` module now supports a `cmr_custom_host` variable that can
  be used to set to an arbitrary  host for making CMR requests (e.g.
  `https://custom-cmr-host.com`).
- Added `buckets` variable to `tf-modules/archive`
- **CUMULUS-2345**
  - Deploy ORCA with Cumulus, see `example/cumulus-tf/orca.tf` and `example/cumulus-tf/terraform.tfvars.example`
  - Add `CopyToGlacier` step to [example IngestAndPublishGranule workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.asl.json)
- **CUMULUS-2424**
  - Added `childWorkflowMeta` to `queue-pdrs` config. An object passed to this config value will be merged into a child workflow message's `meta` object. For an example of how this can be used, see `example/cumulus-tf/discover_and_queue_pdrs_with_child_workflow_meta_workflow.asl.json`.
- **CUMULUS-2427**
  - Added support for using a custom queue with SQS and Kinesis rules. Whatever queue URL is set on the `rule.queueUrl` property will be used to schedule workflows for that rule. This change allows SQS/Kinesis rules to use [any throttled queues defined for a deployment](https://nasa.github.io/cumulus/docs/data-cookbooks/throttling-queued-executions).

### Fixed

- **CUMULUS-2394**
  - Updated PDR and Granule writes to check the step function `workflow_start_time` against
      the `createdAt` field  for each record to ensure old records do not
      overwrite newer ones

### Changed

- `<prefix>-lambda-api-gateway` IAM role used by API Gateway Lambda now
  supports accessing all buckets defined in your `buckets` variable except
  "internal" buckets
- Updated the default scroll duration used in ESScrollSearch and part of the
  reconciliation report functions as a result of testing and seeing timeouts
  at its current value of 2min.
- **CUMULUS-2355**
  - Added logic to disable `/s3Credentials` endpoint based upon value for
    environment variable `DISABLE_S3_CREDENTIALS`. If set to "true", the
    endpoint will not dispense S3 credentials and instead return a message
    indicating that the endpoint has been disabled.
- **CUMULUS-2397**
  - Updated `/elasticsearch` endpoint's `reindex` function to prevent
    reindexing when source and destination indices are the same.
- **CUMULUS-2420**
  - Updated test function `waitForAsyncOperationStatus` to take a retryObject
    and use exponential backoff.  Increased the total test duration for both
    AsycOperation specs and the ReconciliationReports tests.
  - Updated the default scroll duration used in ESScrollSearch and part of the
    reconciliation report functions as a result of testing and seeing timeouts
    at its current value of 2min.
- **CUMULUS-2427**
  - Removed `queueUrl` from the parameters object for `@cumulus/message/Build.buildQueueMessageFromTemplate`
  - Removed `queueUrl` from the parameters object for `@cumulus/message/Build.buildCumulusMeta`

### Fixed

- Fixed issue in `@cumulus/ingest/S3ProviderClient.sync()` preventing 0 byte files from being synced to S3.

### Removed

- Removed variables from `tf-modules/archive`:
  - `private_buckets`
  - `protected_buckets`
  - `public_buckets`

## [v7.0.0] 2021-02-22

### BREAKING CHANGES

- **CUMULUS-2362** - Endpoints for the logs (/logs) will now throw an error unless Metrics is set up

### Added

- **CUMULUS-2345**
  - Deploy ORCA with Cumulus, see `example/cumulus-tf/orca.tf` and `example/cumulus-tf/terraform.tfvars.example`
  - Add `CopyToGlacier` step to [example IngestAndPublishGranule workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.asl.json)
- **CUMULUS-2376**
  - Added `cmrRevisionId` as an optional parameter to `post-to-cmr` that will be used when publishing metadata to CMR.
- **CUMULUS-2412**
  - Adds function `getCollectionsByShortNameAndVersion` to @cumulus/cmrjs that performs a compound query to CMR to retrieve collection information on a list of collections. This replaces a series of calls to the CMR for each collection with a single call on the `/collections` endpoint and should improve performance when CMR return times are increased.

### Changed

- **CUMULUS-2362**
  - Logs endpoints only work with Metrics set up
- **CUMULUS-2376**
  - Updated `publishUMMGJSON2CMR` to take in an optional `revisionId` parameter.
  - Updated `publishUMMGJSON2CMR` to throw an error if optional `revisionId` does not match resulting revision ID.
  - Updated `publishECHO10XML2CMR` to take in an optional `revisionId` parameter.
  - Updated `publishECHO10XML2CMR` to throw an error if optional `revisionId` does not match resulting revision ID.
  - Updated `publish2CMR` to take in optional `cmrRevisionId`.
  - Updated `getWriteHeaders` to take in an optional CMR Revision ID.
  - Updated `ingestGranule` to take in an optional CMR Revision ID to pass to `getWriteHeaders`.
  - Updated `ingestUMMGranule` to take in an optional CMR Revision ID to pass to `getWriteHeaders`.
- **CUMULUS-2350**
  - Updates the examples on the `/s3credentialsREADME`, to include Python and
    JavaScript code demonstrating how to refrsh  the s3credential for
    programatic access.
- **CUMULUS-2383**
  - PostToCMR task will return CMRInternalError when a `500` status is returned from CMR

## [v6.0.0] 2021-02-16

### MIGRATION NOTES

- **CUMULUS-2255** - Cumulus has upgraded its supported version of Terraform
  from **0.12.12** to **0.13.6**. Please see the [instructions to upgrade your
  deployments](https://github.com/nasa/cumulus/blob/master/docs/upgrade-notes/upgrading-tf-version-0.13.6.md).

- **CUMULUS-2350**
  - If the  `/s3credentialsREADME`, does not appear to be working after
    deployment, [manual redeployment](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-deploy-api-with-console.html)
    of the API-gateway stage may be necessary to finish the deployment.

### BREAKING CHANGES

- **CUMULUS-2255** - Cumulus has upgraded its supported version of Terraform from **0.12.12** to **0.13.6**.

### Added

- **CUMULUS-2291**
  - Add provider filter to Granule Inventory Report
- **CUMULUS-2300**
  - Added `childWorkflowMeta` to `queue-granules` config. Object passed to this
    value will be merged into a child workflow message's  `meta` object. For an
    example of how this can be used, see
    `example/cumulus-tf/discover_granules_workflow.asl.json`.
- **CUMULUS-2350**
  - Adds an unprotected endpoint, `/s3credentialsREADME`, to the
    s3-credentials-endpoint that displays  information on how to use the
    `/s3credentials` endpoint
- **CUMULUS-2368**
  - Add QueueWorkflow task
- **CUMULUS-2391**
  - Add reportToEms to collections.files file schema
- **CUMULUS-2395**
  - Add Core module parameter `ecs_custom_sg_ids` to Cumulus module to allow for
    custom security group mappings
- **CUMULUS-2402**
  - Officially expose `sftp()` for use in `@cumulus/sftp-client`

### Changed

- **CUMULUS-2323**
  - The sync granules task when used with the s3 provider now uses the
    `source_bucket` key in `granule.files` objects.  If incoming payloads using
    this task have a `source_bucket` value for a file using the s3 provider, the
    task will attempt to sync from the bucket defined in the file's
    `source_bucket` key instead of the `provider`.
    - Updated `S3ProviderClient.sync` to allow for an optional bucket parameter
      in support of the changed behavior.
  - Removed `addBucketToFile` and related code from sync-granules task

- **CUMULUS-2255**
  - Updated Terraform deployment code syntax for compatibility with version 0.13.6
- **CUMULUS-2321**
  - Updated API endpoint GET `/reconciliationReports/{name}` to return the
    presigned s3 URL in addition to report data

### Fixed

- Updated `hyrax-metadata-updates` task so the opendap url has Type 'USE SERVICE API'

- **CUMULUS-2310**
  - Use valid filename for reconciliation report
- **CUMULUS-2351**
  - Inventory report no longer includes the File/Granule relation object in the
    okCountByGranules key of a report.  The information is only included when a
    'Granule Not Found' report is run.

### Removed

- **CUMULUS-2364**
  - Remove the internal Cumulus logging lambda (log2elasticsearch)

## [v5.0.1] 2021-01-27

### Changed

- **CUMULUS-2344**
  - Elasticsearch API now allows you to reindex to an index that already exists
  - If using the Change Index operation and the new index doesn't exist, it will be created
  - Regarding instructions for CUMULUS-2020, you can now do a change index
    operation before a reindex operation. This will
    ensure that new data will end up in the new index while Elasticsearch is reindexing.

- **CUMULUS-2351**
  - Inventory report no longer includes the File/Granule relation object in the okCountByGranules key of a report. The information is only included when a 'Granule Not Found' report is run.

### Removed

- **CUMULUS-2367**
  - Removed `execution_cumulus_id` column from granules RDS schema and data type

## [v5.0.0] 2021-01-12

### BREAKING CHANGES

- **CUMULUS-2020**
  - Elasticsearch data mappings have been updated to improve search and the API
    has been update to reflect those changes. See Migration notes on how to
    update the Elasticsearch mappings.

### Migration notes

- **CUMULUS-2020**
  - Elasticsearch data mappings have been updated to improve search. For
    example, case insensitive searching will now work (e.g. 'MOD' and 'mod' will
    return the same granule results). To use the improved Elasticsearch queries,
    [reindex](https://nasa.github.io/cumulus-api/#reindex) to create a new index
    with the correct types. Then perform a [change
    index](https://nasa.github.io/cumulus-api/#change-index) operation to use
    the new index.
- **CUMULUS-2258**
  - Because the `egress_lambda_log_group` and
    `egress_lambda_log_subscription_filter` resource were removed from the
    `cumulus` module, new definitions for these resources must be added to
    `cumulus-tf/main.tf`. For reference on how to define these resources, see
    [`example/cumulus-tf/thin_egress_app.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/thin_egress_app.tf).
  - The `tea_stack_name` variable being passed into the `cumulus` module should be removed
- **CUMULUS-2344**
  - Regarding instructions for CUMULUS-2020, you can now do a change index operation before a reindex operation. This will
    ensure that new data will end up in the new index while Elasticsearch is reindexing.

### BREAKING CHANGES

- **CUMULUS-2020**
  - Elasticsearch data mappings have been updated to improve search and the API has been updated to reflect those changes. See Migration notes on how to update the Elasticsearch mappings.

### Added

- **CUMULUS-2318**
  - Added`async_operation_image` as `cumulus` module variable to allow for override of the async_operation container image.  Users can optionally specify a non-default docker image for use with Core async operations.
- **CUMULUS-2219**
  - Added `lzards-backup` Core task to facilitate making LZARDS backup requests in Cumulus ingest workflows
- **CUMULUS-2092**
  - Add documentation for Granule Not Found Reports
- **HYRAX-320**
  - `@cumulus/hyrax-metadata-updates`Add component URI encoding for entry title id and granule ur to allow for values with special characters in them. For example, EntryTitleId 'Sentinel-6A MF/Jason-CS L2 Advanced Microwave Radiometer (AMR-C) NRT Geophysical Parameters' Now, URLs generated from such values will be encoded correctly and parsable by HyraxInTheCloud
- **CUMULUS-1370**
  - Add documentation for Getting Started section including FAQs
- **CUMULUS-2092**
  - Add documentation for Granule Not Found Reports
- **CUMULUS-2219**
  - Added `lzards-backup` Core task to facilitate making LZARDS backup requests in Cumulus ingest workflows
- **CUMULUS-2280**
  - In local api, retry to create tables if they fail to ensure localstack has had time to start fully.
- **CUMULUS-2290**
  - Add `queryFields` to granule schema, and this allows workflow tasks to add queryable data to granule record. For reference on how to add data to `queryFields` field, see [`example/cumulus-tf/kinesis_trigger_test_workflow.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/kinesis_trigger_test_workflow.tf).
- **CUMULUS-2318**
  - Added`async_operation_image` as `cumulus` module variable to allow for override of the async_operation container image.  Users can optionally specify a non-default docker image for use with Core async operations.

### Changed

- **CUMULUS-2020**
  - Updated Elasticsearch mappings to support case-insensitive search
- **CUMULUS-2124**
  - cumulus-rds-tf terraform module now takes engine_version as an input variable.
- **CUMULUS-2279**
  - Changed the formatting of granule CMR links: instead of a link to the `/search/granules.json` endpoint, now it is a direct link to `/search/concepts/conceptid.format`
- **CUMULUS-2296**
  - Improved PDR spec compliance of `parse-pdr` by updating `@cumulus/pvl` to parse fields in a manner more consistent with the PDR ICD, with respect to numbers and dates. Anything not matching the ICD expectations, or incompatible with Javascript parsing, will be parsed as a string instead.
- **CUMULUS-2344**
  - Elasticsearch API now allows you to reindex to an index that already exists
  - If using the Change Index operation and the new index doesn't exist, it will be created

### Removed

- **CUMULUS-2258**
  - Removed `tea_stack_name` variable from `tf-modules/distribution/variables.tf` and `tf-modules/cumulus/variables.tf`
  - Removed `egress_lambda_log_group` and `egress_lambda_log_subscription_filter` resources from `tf-modules/distribution/main.tf`

## [v4.0.0] 2020-11-20

### Migration notes

- Update the name of your `cumulus_message_adapter_lambda_layer_arn` variable for the `cumulus` module to `cumulus_message_adapter_lambda_layer_version_arn`. The value of the variable should remain the same (a layer version ARN of a Lambda layer for the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter/).
- **CUMULUS-2138** - Update all workflows using the `MoveGranules` step to add `UpdateGranulesCmrMetadataFileLinksStep`that runs after it. See the example [`IngestAndPublishWorkflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.asl.json) for reference.
- **CUMULUS-2251**
  - Because it has been removed from the `cumulus` module, a new resource definition for `egress_api_gateway_log_subscription_filter` must be added to `cumulus-tf/main.tf`. For reference on how to define this resource, see [`example/cumulus-tf/main.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf).

### Added

- **CUMULUS-2248**
  - Updates Integration Tests README to point to new fake provider template.
- **CUMULUS-2239**
  - Add resource declaration to create a VPC endpoint in tea-map-cache module if `deploy_to_ngap` is false.
- **CUMULUS-2063**
  - Adds a new, optional query parameter to the `/collections[&getMMT=true]` and `/collections/active[&getMMT=true]` endpoints. When a user provides a value of `true` for `getMMT` in the query parameters, the endpoint will search CMR and update each collection's results with new key `MMTLink` containing a link to the MMT (Metadata Management Tool) if a CMR collection id is found.
- **CUMULUS-2170**
  - Adds ability to filter granule inventory reports
- **CUMULUS-2211**
  - Adds `granules/bulkReingest` endpoint to `@cumulus/api`
- **CUMULUS-2251**
  - Adds `log_api_gateway_to_cloudwatch` variable to `example/cumulus-tf/variables.tf`.
  - Adds `log_api_gateway_to_cloudwatch` variable to `thin_egress_app` module definition.

### Changed

- **CUMULUS-2216**
  - `/collection` and `/collection/active` endpoints now return collections without granule aggregate statistics by default. The original behavior is preserved and can be found by including a query param of `includeStats=true` on the request to the endpoint.
  - The `es/collections` Collection class takes a new parameter includeStats. It no longer appends granule aggregate statistics to the returned results by default. One must set the new parameter to any non-false value.
- **CUMULUS-2201**
  - Update `dbIndexer` lambda to process requests in serial
  - Fixes ingestPdrWithNodeNameSpec parsePdr provider error
- **CUMULUS-2251**
  - Moves Egress Api Gateway Log Group Filter from `tf-modules/distribution/main.tf` to `example/cumulus-tf/main.tf`

### Fixed

- **CUMULUS-2251**
  - This fixes a deployment error caused by depending on the `thin_egress_app` module output for a resource count.

### Removed

- **CUMULUS-2251**
  - Removes `tea_api_egress_log_group` variable from `tf-modules/distribution/variables.tf` and `tf-modules/cumulus/variables.tf`.

### BREAKING CHANGES

- **CUMULUS-2138** - CMR metadata update behavior has been removed from the `move-granules` task into a
new `update-granules-cmr-metadata-file-links` task.
- **CUMULUS-2216**
  - `/collection` and `/collection/active` endpoints now return collections without granule aggregate statistics by default. The original behavior is preserved and can be found by including a query param of `includeStats=true` on the request to the endpoint.  This is likely to affect the dashboard only but included here for the change of behavior.
- **[1956](https://github.com/nasa/cumulus/issues/1956)**
  - Update the name of the `cumulus_message_adapter_lambda_layer_arn` output from the `cumulus-message-adapter` module to `cumulus_message_adapter_lambda_layer_version_arn`. The output value has changed from being the ARN of the Lambda layer **without a version** to the ARN of the Lambda layer **with a version**.
  - Update the variable name in the `cumulus` and `ingest` modules from `cumulus_message_adapter_lambda_layer_arn` to `cumulus_message_adapter_lambda_layer_version_arn`

## [v3.0.1] 2020-10-21

- **CUMULUS-2203**
  - Update Core tasks to use
    [cumulus-message-adapter-js](https://github.com/nasa/cumulus-message-adapter-js)
    v2.0.0 to resolve memory leak/lambda ENOMEM constant failure issue.   This
    issue caused lambdas to slowly use all memory in the run environment and
    prevented AWS from halting/restarting warmed instances when task code was
    throwing consistent errors under load.

- **CUMULUS-2232**
  - Updated versions for `ajv`, `lodash`, `googleapis`, `archiver`, and
    `@cumulus/aws-client` to remediate vulnerabilities found in SNYK scan.

### Fixed

- **CUMULUS-2233**
  - Fixes /s3credentials bug where the expiration time on the cookie was set to a time that is always expired, so authentication was never being recognized as complete by the API. Consequently, the user would end up in a redirect loop and requests to /s3credentials would never complete successfully. The bug was caused by the fact that the code setting the expiration time for the cookie was expecting a time value in milliseconds, but was receiving the expirationTime from the EarthdataLoginClient in seconds. This bug has been fixed by converting seconds into milliseconds. Unit tests were added to test that the expiration time has been converted to milliseconds and checking that the cookie's expiration time is greater than the current time.

## [v3.0.0] 2020-10-7

### MIGRATION STEPS

- **CUMULUS-2099**
  - All references to `meta.queues` in workflow configuration must be replaced with references to queue URLs from Terraform resources. See the updated [data cookbooks](https://nasa.github.io/cumulus/docs/data-cookbooks/about-cookbooks) or example [Discover Granules workflow configuration](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/discover_granules_workflow.asl.json).
  - The steps for configuring queued execution throttling have changed. See the [updated documentation](https://nasa.github.io/cumulus/docs/data-cookbooks/throttling-queued-executions).
  - In addition to the configuration for execution throttling, the internal mechanism for tracking executions by queue has changed. As a result, you should **disable any rules or workflows scheduling executions via a throttled queue** before upgrading. Otherwise, you may be at risk of having **twice as many executions** as are configured for the queue while the updated tracking is deployed. You can re-enable these rules/workflows once the upgrade is complete.

- **CUMULUS-2111**
  - **Before you re-deploy your `cumulus-tf` module**, note that the [`thin-egress-app`][thin-egress-app] is no longer deployed by default as part of the `cumulus` module, so you must add the TEA module to your deployment and manually modify your Terraform state **to avoid losing your API gateway and impacting any Cloudfront endpoints pointing to those gateways**. If you don't care about losing your API gateway and impacting Cloudfront endpoints, you can ignore the instructions for manually modifying state.

    1. Add the [`thin-egress-app`][thin-egress-app] module to your `cumulus-tf` deployment as shown in the [Cumulus example deployment](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf/main.tf).

         - Note that the values for `tea_stack_name` variable to the `cumulus` module and the `stack_name` variable to the `thin_egress_app` module **must match**
         - Also, if you are specifying the `stage_name` variable to the `thin_egress_app` module, **the value of the `tea_api_gateway_stage` variable to the `cumulus` module must match it**

    2. **If you want to preserve your existing `thin-egress-app` API gateway and avoid having to update your Cloudfront endpoint for distribution, then you must follow these instructions**: <https://nasa.github.io/cumulus/docs/upgrade-notes/migrate_tea_standalone>. Otherwise, you can re-deploy as usual.

  - If you provide your own custom bucket map to TEA as a standalone module, **you must ensure that your custom bucket map includes mappings for the `protected` and `public` buckets specified in your `cumulus-tf/terraform.tfvars`, otherwise Cumulus may not be able to determine the correct distribution URL for ingested files and you may encounter errors**

- **CUMULUS-2197**
  - EMS resources are now optional, and `ems_deploy` is set to `false` by default, which will delete your EMS resources.
  - If you would like to keep any deployed EMS resources, add the `ems_deploy` variable set to `true` in your `cumulus-tf/terraform.tfvars`

### BREAKING CHANGES

- **CUMULUS-2200**
  - Changes return from 303 redirect to 200 success for `Granule Inventory`'s
    `/reconciliationReport` returns.  The user (dashboard) must read the value
    of `url` from the return to get the s3SignedURL and then download the report.
- **CUMULUS-2099**
  - `meta.queues` has been removed from Cumulus core workflow messages.
  - `@cumulus/sf-sqs-report` workflow task no longer reads the reporting queue URL from `input.meta.queues.reporting` on the incoming event. Instead, it requires that the queue URL be set as the `reporting_queue_url` environment variable on the deployed Lambda.
- **CUMULUS-2111**
  - The deployment of the `thin-egress-app` module has be removed from `tf-modules/distribution`, which is a part of the `tf-modules/cumulus` module. Thus, the `thin-egress-app` module is no longer deployed for you by default. See the migration steps for details about how to add deployment for the `thin-egress-app`.
- **CUMULUS-2141**
  - The `parse-pdr` task has been updated to respect the `NODE_NAME` property in
    a PDR's `FILE_GROUP`. If a `NODE_NAME` is present, the task will query the
    Cumulus API for a provider with that host. If a provider is found, the
    output granule from the task will contain a `provider` property containing
    that provider. If `NODE_NAME` is set but a provider with that host cannot be
    found in the API, or if multiple providers are found with that same host,
    the task will fail.
  - The `queue-granules` task has been updated to expect an optional
    `granule.provider` property on each granule. If present, the granule will be
    enqueued using that provider. If not present, the task's `config.provider`
    will be used instead.
- **CUMULUS-2197**
  - EMS resources are now optional and will not be deployed by default. See migration steps for information
    about how to deploy EMS resources.

#### CODE CHANGES

- The `@cumulus/api-client.providers.getProviders` function now takes a
  `queryStringParameters` parameter which can be used to filter the providers
  which are returned
- The `@cumulus/aws-client/S3.getS3ObjectReadStreamAsync` function has been
  removed. It read the entire S3 object into memory before returning a read
  stream, which could cause Lambdas to run out of memory. Use
  `@cumulus/aws-client/S3.getObjectReadStream` instead.
- The `@cumulus/ingest/util.lookupMimeType` function now returns `undefined`
  rather than `null` if the mime type could not be found.
- The `@cumulus/ingest/lock.removeLock` function now returns `undefined`
- The `@cumulus/ingest/granule.generateMoveFileParams` function now returns
  `source: undefined` and `target :undefined` on the response object if either could not be
  determined. Previously, `null` had been returned.
- The `@cumulus/ingest/recursion.recursion` function must now be imported using
  `const { recursion } = require('@cumulus/ingest/recursion');`
- The `@cumulus/ingest/granule.getRenamedS3File` function has been renamed to
  `listVersionedObjects`
- `@cumulus/common.http` has been removed
- `@cumulus/common/http.download` has been removed

### Added

- **CUMULUS-1855**
  - Fixed SyncGranule task to return an empty granules list when given an empty
    (or absent) granules list on input, rather than throwing an exception
- **CUMULUS-1955**
  - Added `@cumulus/aws-client/S3.getObject` to get an AWS S3 object
  - Added `@cumulus/aws-client/S3.waitForObject` to get an AWS S3 object,
    retrying, if necessary
- **CUMULUS-1961**
  - Adds `startTimestamp` and `endTimestamp` parameters to endpoint
    `reconcilationReports`.  Setting these values will filter the returned
    report to cumulus data that falls within the timestamps. It also causes the
    report to be one directional, meaning cumulus is only reconciled with CMR,
    but not the other direction. The Granules will be filtered by their
    `updatedAt` values. Collections are filtered by the updatedAt time of their
    granules, i.e. Collections with granules that are updatedAt a time between
    the time parameters will be returned in the reconciliation reports.
  - Adds `startTimestamp` and `endTimestamp` parameters to create-reconciliation-reports
    lambda function. If either of these params is passed in with a value that can be
    converted to a date object, the inter-platform comparison between Cumulus and CMR will
    be one way.  That is, collections, granules, and files will be filtered by time for
    those found in Cumulus and only those compared to the CMR holdings. For the moment
    there is not enough information to change the internal consistency check, and S3 vs
    Cumulus comparisons are unchanged by the timestamps.
- **CUMULUS-1962**
  - Adds `location` as parameter to `/reconciliationReports` endpoint. Options are `S3`
    resulting in a S3 vs. Cumulus database search or `CMR` resulting in CMR vs. Cumulus database search.
- **CUMULUS-1963**
  - Adds `granuleId` as input parameter to `/reconcilationReports`
    endpoint. Limits inputs parameters to either `collectionId` or `granuleId`
    and will fail to create the report if both are provided.  Adding granuleId
    will find collections in Cumulus by granuleId and compare those one way
    with those in CMR.
  - `/reconciliationReports` now validates any input json before starting the
    async operation and the lambda handler no longer validates input
    parameters.
- **CUMULUS-1964**
  - Reports can now be filtered on provider
- **CUMULUS-1965**
  - Adds `collectionId` parameter to the `/reconcilationReports`
    endpoint. Setting this value will limit the scope of the reconcilation
    report to only the input collectionId when comparing Cumulus and
    CMR. `collectionId` is provided an array of strings e.g. `[shortname___version, shortname2___version2]`
- **CUMULUS-2107**
  - Added a new task, `update-cmr-access-constraints`, that will set access constraints in CMR Metadata.
    Currently supports UMMG-JSON and Echo10XML, where it will configure `AccessConstraints` and
    `RestrictionFlag/RestrictionComment`, respectively.
  - Added an operator doc on how to configure and run the access constraint update workflow, which will update the metadata using the new task, and then publish the updated metadata to CMR.
  - Added an operator doc on bulk operations.
- **CUMULUS-2111**
  - Added variables to `cumulus` module:
    - `tea_api_egress_log_group`
    - `tea_external_api_endpoint`
    - `tea_internal_api_endpoint`
    - `tea_rest_api_id`
    - `tea_rest_api_root_resource_id`
    - `tea_stack_name`
  - Added variables to `distribution` module:
    - `tea_api_egress_log_group`
    - `tea_external_api_endpoint`
    - `tea_internal_api_endpoint`
    - `tea_rest_api_id`
    - `tea_rest_api_root_resource_id`
    - `tea_stack_name`
- **CUMULUS-2112**
  - Added `@cumulus/api/lambdas/internal-reconciliation-report`, so create-reconciliation-report
    lambda can create `Internal` reconciliation report
- **CUMULUS-2116**
  - Added `@cumulus/api/models/granule.unpublishAndDeleteGranule` which
  unpublishes a granule from CMR and deletes it from Cumulus, but does not
  update the record to `published: false` before deletion
- **CUMULUS-2113**
  - Added Granule not found report to reports endpoint
  - Update reports to return breakdown by Granule of files both in DynamoDB and S3
- **CUMULUS-2123**
  - Added `cumulus-rds-tf` DB cluster module to `tf-modules` that adds a
    serverless RDS Aurora/PostgreSQL database cluster to meet the PostgreSQL
    requirements for future releases.
  - Updated the default Cumulus module to take the following new required variables:
    - rds_user_access_secret_arn:
      AWS Secrets Manager secret ARN containing a JSON string of DB credentials
      (containing at least host, password, port as keys)
    - rds_security_group:
      RDS Security Group that provides connection access to the RDS cluster
  - Updated API lambdas and default ECS cluster to add them to the
    `rds_security_group` for database access
- **CUMULUS-2126**
  - The collections endpoint now writes to the RDS database
- **CUMULUS-2127**
  - Added migration to create collections relation for RDS database
- **CUMULUS-2129**
  - Added `data-migration1` Terraform module and Lambda to migrate data from Dynamo to RDS
    - Added support to Lambda for migrating collections data from Dynamo to RDS
- **CUMULUS-2155**
  - Added `rds_connection_heartbeat` to `cumulus` and `data-migration` tf
    modules.  If set to true, this diagnostic variable instructs Core's database
    code to fire off a connection 'heartbeat' query and log the timing/results
    for diagnostic purposes, and retry certain connection timeouts once.
    This option is disabled by default
- **CUMULUS-2156**
  - Support array inputs parameters for `Internal` reconciliation report
- **CUMULUS-2157**
  - Added support to `data-migration1` Lambda for migrating providers data from Dynamo to RDS
    - The migration process for providers will convert any credentials that are stored unencrypted or encrypted with an S3 keypair provider to be encrypted with a KMS key instead
- **CUMULUS-2161**
  - Rules now support an `executionNamePrefix` property. If set, any executions
    triggered as a result of that rule will use that prefix in the name of the
    execution.
  - The `QueueGranules` task now supports an `executionNamePrefix` property. Any
    executions queued by that task will use that prefix in the name of the
    execution. See the
    [example workflow](./example/cumulus-tf/discover_granules_with_execution_name_prefix_workflow.asl.json)
    for usage.
  - The `QueuePdrs` task now supports an `executionNamePrefix` config property.
    Any executions queued by that task will use that prefix in the name of the
    execution. See the
    [example workflow](./example/cumulus-tf/discover_and_queue_pdrs_with_execution_name_prefix_workflow.asl.json)
    for usage.
- **CUMULUS-2162**
  - Adds new report type to `/reconciliationReport` endpoint.  The new report
    is `Granule Inventory`. This report is a CSV file of all the granules in
    the Cumulus DB. This report will eventually replace the existing
    `granules-csv` endpoint which has been deprecated.
- **CUMULUS-2197**
  - Added `ems_deploy` variable to the `cumulus` module. This is set to false by default, except
    for our example deployment, where it is needed for integration tests.

### Changed

- Upgraded version of [TEA](https://github.com/asfadmin/thin-egress-app/) deployed with Cumulus to build 88.
- **CUMULUS-2107**
  - Updated the `applyWorkflow` functionality on the granules endpoint to take a `meta` property to pass into the workflow message.
  - Updated the `BULK_GRANULE` functionality on the granules endpoint to support the above `applyWorkflow` change.
- **CUMULUS-2111**
  - Changed `distribution_api_gateway_stage` variable for `cumulus` module to `tea_api_gateway_stage`
  - Changed `api_gateway_stage` variable for `distribution` module to `tea_api_gateway_stage`
- **CUMULUS-2224**
  - Updated `/reconciliationReport`'s file reconciliation to include `"EXTENDED METADATA"` as a valid CMR relatedUrls Type.

### Fixed

- **CUMULUS-2168**
  - Fixed issue where large number of documents (generally logs) in the
    `cumulus` elasticsearch index results in the collection granule stats
    queries failing for the collections list api endpoint
- **CUMULUS-1955**
  - Due to AWS's eventual consistency model, it was possible for PostToCMR to
    publish an earlier version of a CMR metadata file, rather than the latest
    version created in a workflow.  This fix guarantees that the latest version
    is published, as expected.
- **CUMULUS-1961**
  - Fixed `activeCollections` query only returning 10 results
- **CUMULUS-2201**
  - Fix Reconciliation Report integration test failures by waiting for collections appear
    in es list and ingesting a fake granule xml file to CMR
- **CUMULUS-2015**
  - Reduced concurrency of `QueueGranules` task. That task now has a
    `config.concurrency` option that defaults to `3`.
- **CUMULUS-2116**
  - Fixed a race condition with bulk granule delete causing deleted granules to still appear in Elasticsearch. Granules removed via bulk delete should now be removed from Elasticsearch.
- **CUMULUS-2163**
  - Remove the `public-read` ACL from the `move-granules` task
- **CUMULUS-2164**
  - Fix issue where `cumulus` index is recreated and attached to an alias if it has been previously deleted
- **CUMULUS-2195**
  - Fixed issue with redirect from `/token` not working when using a Cloudfront endpoint to access the Cumulus API with Launchpad authentication enabled. The redirect should now work properly whether you are using a plain API gateway URL or a Cloudfront endpoint pointing at an API gateway URL.
- **CUMULUS-2200**
  - Fixed issue where __in and __not queries were stripping spaces from values

### Deprecated

- **CUMULUS-1955**
  - `@cumulus/aws-client/S3.getS3Object()`
  - `@cumulus/message/Queue.getQueueNameByUrl()`
  - `@cumulus/message/Queue.getQueueName()`
- **CUMULUS-2162**
  - `@cumulus/api/endpoints/granules-csv/list()`

### Removed

- **CUMULUS-2111**
  - Removed `distribution_url` and `distribution_redirect_uri` outputs from the `cumulus` module
  - Removed variables from the `cumulus` module:
    - `distribution_url`
    - `log_api_gateway_to_cloudwatch`
    - `thin_egress_cookie_domain`
    - `thin_egress_domain_cert_arn`
    - `thin_egress_download_role_in_region_arn`
    - `thin_egress_jwt_algo`
    - `thin_egress_jwt_secret_name`
    - `thin_egress_lambda_code_dependency_archive_key`
    - `thin_egress_stack_name`
  - Removed outputs from the `distribution` module:
    - `distribution_url`
    - `internal_tea_api`
    - `rest_api_id`
    - `thin_egress_app_redirect_uri`
  - Removed variables from the `distribution` module:
    - `bucket_map_key`
    - `distribution_url`
    - `log_api_gateway_to_cloudwatch`
    - `thin_egress_cookie_domain`
    - `thin_egress_domain_cert_arn`
    - `thin_egress_download_role_in_region_arn`
    - `thin_egress_jwt_algo`
    - `thin_egress_jwt_secret_name`
    - `thin_egress_lambda_code_dependency_archive_key`
- **CUMULUS-2157**
  - Removed `providerSecretsMigration` and `verifyProviderSecretsMigration` lambdas
- Removed deprecated `@cumulus/sf-sns-report` task
- Removed code:
  - `@cumulus/aws-client/S3.calculateS3ObjectChecksum`
  - `@cumulus/aws-client/S3.getS3ObjectReadStream`
  - `@cumulus/cmrjs.getFullMetadata`
  - `@cumulus/cmrjs.getMetadata`
  - `@cumulus/common/util.isNil`
  - `@cumulus/common/util.isNull`
  - `@cumulus/common/util.isUndefined`
  - `@cumulus/common/util.lookupMimeType`
  - `@cumulus/common/util.mkdtempSync`
  - `@cumulus/common/util.negate`
  - `@cumulus/common/util.noop`
  - `@cumulus/common/util.omit`
  - `@cumulus/common/util.renameProperty`
  - `@cumulus/common/util.sleep`
  - `@cumulus/common/util.thread`
  - `@cumulus/ingest/granule.copyGranuleFile`
  - `@cumulus/ingest/granule.moveGranuleFile`
  - `@cumulus/integration-tests/api/rules.deleteRule`
  - `@cumulus/integration-tests/api/rules.getRule`
  - `@cumulus/integration-tests/api/rules.listRules`
  - `@cumulus/integration-tests/api/rules.postRule`
  - `@cumulus/integration-tests/api/rules.rerunRule`
  - `@cumulus/integration-tests/api/rules.updateRule`
  - `@cumulus/integration-tests/sfnStep.parseStepMessage`
  - `@cumulus/message/Queue.getQueueName`
  - `@cumulus/message/Queue.getQueueNameByUrl`

## v2.0.2+ Backport releases

Release v2.0.1 was the last release on the 2.0.x release series.

Changes after this version on the 2.0.x release series are limited
security/requested feature patches and will not be ported forward to future
releases unless there is a corresponding CHANGELOG entry.

For up-to-date CHANGELOG for the maintenance release branch see
[CHANGELOG.md](https://github.com/nasa/cumulus/blob/release-2.0.x/CHANGELOG.md)
from the 2.0.x branch.

For the most recent release information for the maintenance branch please see
the [release page](https://github.com/nasa/cumulus/releases)

## [v2.0.7] 2020-10-1 - [BACKPORT]

### Fixed

- CVE-2020-7720
  - Updated common `node-forge` dependency to 0.10.0 to address CVE finding

### [v2.0.6] 2020-09-25 - [BACKPORT]

### Fixed

- **CUMULUS-2168**
  - Fixed issue where large number of documents (generally logs) in the
    `cumulus` elasticsearch index results in the collection granule stats
    queries failing for the collections list api endpoint

### [v2.0.5] 2020-09-15 - [BACKPORT]

#### Added

- Added `thin_egress_stack_name` variable to `cumulus` and `distribution` Terraform modules to allow overriding the default Cloudformation stack name used for the `thin-egress-app`. **Please note that if you change/set this value for an existing deployment, it will destroy and re-create your API gateway for the `thin-egress-app`.**

#### Fixed

- Fix collection list queries. Removed fixes to collection stats, which break queries for a large number of granules.

### [v2.0.4] 2020-09-08 - [BACKPORT]

#### Changed

- Upgraded version of [TEA](https://github.com/asfadmin/thin-egress-app/) deployed with Cumulus to build 88.

### [v2.0.3] 2020-09-02 - [BACKPORT]

#### Fixed

- **CUMULUS-1961**
  - Fixed `activeCollections` query only returning 10 results

- **CUMULUS-2039**
  - Fix issue causing SyncGranules task to run out of memory on large granules

#### CODE CHANGES

- The `@cumulus/aws-client/S3.getS3ObjectReadStreamAsync` function has been
  removed. It read the entire S3 object into memory before returning a read
  stream, which could cause Lambdas to run out of memory. Use
  `@cumulus/aws-client/S3.getObjectReadStream` instead.

### [v2.0.2] 2020-08-17 - [BACKPORT]

#### CODE CHANGES

- The `@cumulus/ingest/util.lookupMimeType` function now returns `undefined`
  rather than `null` if the mime type could not be found.
- The `@cumulus/ingest/lock.removeLock` function now returns `undefined`

#### Added

- **CUMULUS-2116**
  - Added `@cumulus/api/models/granule.unpublishAndDeleteGranule` which
  unpublishes a granule from CMR and deletes it from Cumulus, but does not
  update the record to `published: false` before deletion

### Fixed

- **CUMULUS-2116**
  - Fixed a race condition with bulk granule delete causing deleted granules to still appear in Elasticsearch. Granules removed via bulk delete should now be removed from Elasticsearch.

## [v2.0.1] 2020-07-28

### Added

- **CUMULUS-1886**
  - Added `multiple sort keys` support to `@cumulus/api`
- **CUMULUS-2099**
  - `@cumulus/message/Queue.getQueueUrl` to get the queue URL specified in a Cumulus workflow message, if any.

### Fixed

- **[PR 1790](https://github.com/nasa/cumulus/pull/1790)**
  - Fixed bug with request headers in `@cumulus/launchpad-auth` causing Launchpad token requests to fail

## [v2.0.0] 2020-07-23

### BREAKING CHANGES

- Changes to the `@cumulus/api-client` package
  - The `CumulusApiClientError` class must now be imported using
    `const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError')`
- The `@cumulus/sftp-client/SftpClient` class must now be imported using
  `const { SftpClient } = require('@cumulus/sftp-client');`
- Instances of `@cumulus/ingest/SftpProviderClient` no longer implicitly connect
  when `download`, `list`, or `sync` are called. You must call `connect` on the
  provider client before issuing one of those calls. Failure to do so will
  result in a "Client not connected" exception being thrown.
- Instances of `@cumulus/ingest/SftpProviderClient` no longer implicitly
  disconnect from the SFTP server when `list` is called.
- Instances of `@cumulus/sftp-client/SftpClient` must now be explicitly closed
  by calling `.end()`
- Instances of `@cumulus/sftp-client/SftpClient` no longer implicitly connect to
  the server when `download`, `unlink`, `syncToS3`, `syncFromS3`, and `list` are
  called. You must explicitly call `connect` before calling one of those
  methods.
- Changes to the `@cumulus/common` package
  - `cloudwatch-event.getSfEventMessageObject()` now returns `undefined` if the
    message could not be found or could not be parsed. It previously returned
    `null`.
  - `S3KeyPairProvider.decrypt()` now throws an exception if the bucket
    containing the key cannot be determined.
  - `S3KeyPairProvider.decrypt()` now throws an exception if the stack cannot be
    determined.
  - `S3KeyPairProvider.encrypt()` now throws an exception if the bucket
    containing the key cannot be determined.
  - `S3KeyPairProvider.encrypt()` now throws an exception if the stack cannot be
    determined.
  - `sns-event.getSnsEventMessageObject()` now returns `undefined` if it could
    not be parsed. It previously returned `null`.
  - The `aws` module has been removed.
  - The `BucketsConfig.buckets` property is now read-only and private
  - The `test-utils.validateConfig()` function now resolves to `undefined`
    rather than `true`.
  - The `test-utils.validateInput()` function now resolves to `undefined` rather
    than `true`.
  - The `test-utils.validateOutput()` function now resolves to `undefined`
    rather than `true`.
  - The static `S3KeyPairProvider.retrieveKey()` function has been removed.
- Changes to the `@cumulus/cmrjs` package
  - `@cumulus/cmrjs.constructOnlineAccessUrl()` and
    `@cumulus/cmrjs/cmr-utils.constructOnlineAccessUrl()` previously took a
    `buckets` parameter, which was an instance of
    `@cumulus/common/BucketsConfig`. They now take a `bucketTypes` parameter,
    which is a simple object mapping bucket names to bucket types. Example:
    `{ 'private-1': 'private', 'public-1': 'public' }`
  - `@cumulus/cmrjs.reconcileCMRMetadata()` and
    `@cumulus/cmrjs/cmr-utils.reconcileCMRMetadata()` now take a **required**
    `bucketTypes` parameter, which is a simple object mapping bucket names to
    bucket types. Example: `{ 'private-1': 'private', 'public-1': 'public' }`
  - `@cumulus/cmrjs.updateCMRMetadata()` and
    `@cumulus/cmrjs/cmr-utils.updateCMRMetadata()` previously took an optional
    `inBuckets` parameter, which was an instance of
    `@cumulus/common/BucketsConfig`. They now take a **required** `bucketTypes`
    parameter, which is a simple object mapping bucket names to bucket types.
    Example: `{ 'private-1': 'private', 'public-1': 'public' }`
- The minimum supported version of all published Cumulus packages is now Node
  12.18.0
  - Tasks using the `cumuluss/cumulus-ecs-task` Docker image must be updated to
    `cumuluss/cumulus-ecs-task:1.7.0`. This can be done by updating the `image`
    property of any tasks defined using the `cumulus_ecs_service` Terraform
    module.
- Changes to `@cumulus/aws-client/S3`
  - The signature of the `getObjectSize` function has changed. It now takes a
    params object with three properties:
    - **s3**: an instance of an AWS.S3 object
    - **bucket**
    - **key**
  - The `getObjectSize` function will no longer retry if the object does not
    exist
- **CUMULUS-1861**
  - `@cumulus/message/Collections.getCollectionIdFromMessage` now throws a
    `CumulusMessageError` if `collectionName` and `collectionVersion` are missing
    from `meta.collection`.   Previously this method would return
    `'undefined___undefined'` instead
  - `@cumulus/integration-tests/addCollections` now returns an array of collections that
    were added rather than the count of added collections
- **CUMULUS-1930**
  - The `@cumulus/common/util.uuid()` function has been removed
- **CUMULUS-1955**
  - `@cumulus/aws-client/S3.multipartCopyObject` now returns an object with the
    AWS `etag` of the destination object
  - `@cumulus/ingest/S3ProviderClient.list` now sets a file object's `path`
    property to `undefined` instead of `null` when the file is at the top level
    of its bucket
  - The `sync` methods of the following classes in the `@cumulus/ingest` package
    now return an object with the AWS `s3uri` and `etag` of the destination file
    (they previously returned only a string representing the S3 URI)
    - `FtpProviderClient`
    - `HttpProviderClient`
    - `S3ProviderClient`
    - `SftpProviderClient`
- **CUMULUS-1958**
  - The following methods exported from `@cumulus/cmr-js/cmr-utils` were made
    async, and added distributionBucketMap as a parameter:
    - constructOnlineAccessUrl
    - generateFileUrl
    - reconcileCMRMetadata
    - updateCMRMetadata
- **CUMULUS-1969**
  - The `DiscoverPdrs` task now expects `provider_path` to be provided at
    `event.config.provider_path`, not `event.config.collection.provider_path`
  - `event.config.provider_path` is now a required parameter of the
    `DiscoverPdrs` task
  - `event.config.collection` is no longer a parameter to the `DiscoverPdrs`
    task
  - Collections no longer support the `provider_path` property. The tasks that
    relied on that property are now referencing `config.meta.provider_path`.
    Workflows should be updated accordingly.
- **CUMULUS-1977**
  - Moved bulk granule deletion endpoint from `/bulkDelete` to
    `/granules/bulkDelete`
- **CUMULUS-1991**
  - Updated CMR metadata generation to use "Download file.hdf" (where `file.hdf` is the filename of the given resource) as the resource description instead of "File to download"
  - CMR metadata updates now respect changes to resource descriptions (previously only changes to resource URLs were respected)

### MIGRATION STEPS

- Due to an issue with the AWS API Gateway and how the Thin Egress App Cloudformation template applies updates, you may need to redeploy your
  `thin-egress-app-EgressGateway` manually as a one time migration step.    If your deployment fails with an
  error similar to:

  ```bash
  Error: Lambda function (<stack>-tf-TeaCache) returned error: ({"errorType":"HTTPError","errorMessage":"Response code 404 (Not Found)"})
  ```

  Then follow the [AWS
  instructions](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-deploy-api-with-console.html)
  to `Redeploy a REST API to a stage` for your egress API and re-run `terraform
  apply`.

### Added

- **CUMULUS-2081**
  - Add Integrator Guide section for onboarding
  - Add helpful tips documentation

- **CUMULUS-1902**
  - Add Common Use Cases section under Operator Docs

- **CUMULUS-2058**
  - Added `lambda_processing_role_name` as an output from the `cumulus` module
    to provide the processing role name
- **CUMULUS-1417**
  - Added a `checksumFor` property to collection `files` config. Set this
    property on a checksum file's definition matching the `regex` of the target
    file. More details in the ['Data Cookbooks
    Setup'](https://nasa.github.io/cumulus/docs/next/data-cookbooks/setup)
    documentation.
  - Added `checksumFor` validation to collections model.
- **CUMULUS-1956**
  - Added `@cumulus/earthata-login-client` package
  - The `/s3credentials` endpoint that is deployed as part of distribution now
    supports authentication using tokens created by a different application. If
    a request contains the `EDL-ClientId` and `EDL-Token` headers,
    authentication will be handled using that token rather than attempting to
    use OAuth.
  - `@cumulus/earthata-login-client.getTokenUsername()` now accepts an
    `xRequestId` argument, which will be included as the `X-Request-Id` header
    when calling Earthdata Login.
  - If the `s3Credentials` endpoint is invoked with an EDL token and an
    `X-Request-Id` header, that `X-Request-Id` header will be forwarded to
    Earthata Login.
- **CUMULUS-1957**
  - If EDL token authentication is being used, and the `EDL-Client-Name` header
    is set, `@the-client-name` will be appended to the end of the Earthdata
    Login username that is used as the `RoleSessionName` of the temporary IAM
    credentials. This value will show up in the AWS S3 server access logs.
- **CUMULUS-1958**
  - Add the ability for users to specify a `bucket_map_key` to the `cumulus`
    terraform module as an override for the default .yaml values that are passed
    to TEA by Core.    Using this option *requires* that each configured
    Cumulus 'distribution' bucket (e.g. public/protected buckets) have a single
    TEA mapping.  Multiple maps per bucket are not supported.
  - Updated Generating a distribution URL, the MoveGranules task and all CMR
    reconciliation functionality to utilize the TEA bucket map override.
  - Updated deploy process to utilize a bootstrap 'tea-map-cache' lambda that
    will, after deployment of Cumulus Core's TEA instance, query TEA for all
    protected/public buckets and generate a mapping configuration used
    internally by Core.  This object is also exposed as an output of the Cumulus
    module as `distribution_bucket_map`.
- **CUMULUS-1961**
  - Replaces DynamoDB for Elasticsearch for reconciliationReportForCumulusCMR
    comparisons between Cumulus and CMR.
- **CUMULUS-1970**
  - Created the `add-missing-file-checksums` workflow task
  - Added `@cumulus/aws-client/S3.calculateObjectHash()` function
  - Added `@cumulus/aws-client/S3.getObjectReadStream()` function
- **CUMULUS-1887**
  - Add additional fields to the granule CSV download file
- **CUMULUS-2019**
  - Add `infix` search to es query builder `@cumulus/api/es/es/queries` to
    support partial matching of the keywords

### Changed

- **CUMULUS-2032**
  - Updated @cumulus/ingest/HttpProviderClient to utilize a configuration key
    `httpListTimeout` to set the default timeout for discovery HTTP/HTTPS
    requests, and updates the default for the provider to 5 minutes (300 seconds).
  - Updated the DiscoverGranules and DiscoverPDRs tasks to utilize the updated
    configuration value if set via workflow config, and updates the default for
    these tasks to 5 minutes (300 seconds).

- **CUMULUS-176**
  - The API will now respond with a 400 status code when a request body contains
    invalid JSON. It had previously returned a 500 status code.
- **CUMULUS-1861**
  - Updates Rule objects to no longer require a collection.
  - Changes the DLQ behavior for `sfEventSqsToDbRecords` and
    `sfEventSqsToDbRecordsInputQueue`. Previously failure to write a database
    record would result in lambda success, and an error log in the CloudWatch
    logs.   The lambda has been updated to manually add a record to
    the `sfEventSqsToDbRecordsDeadLetterQueue` if the granule, execution, *or*
    pdr record fails to write, in addition to the previous error logging.
- **CUMULUS-1956**
  - The `/s3credentials` endpoint that is deployed as part of distribution now
    supports authentication using tokens created by a different application. If
    a request contains the `EDL-ClientId` and `EDL-Token` headers,
    authentication will be handled using that token rather than attempting to
    use OAuth.
- **CUMULUS-1977**
  - API endpoint POST `/granules/bulk` now returns a 202 status on a successful
    response instead of a 200 response
  - API endpoint DELETE `/granules/<granule-id>` now returns a 404 status if the
    granule record was already deleted
  - `@cumulus/api/models/Granule.update()` now returns the updated granule
    record
  - Implemented POST `/granules/bulkDelete` API endpoint to support deleting
    granules specified by ID or returned by the provided query in the request
    body. If the request is successful, the endpoint returns the async operation
    ID that has been started to remove the granules.
    - To use a query in the request body, your deployment must be
      [configured to access the Elasticsearch host for ESDIS metrics](https://nasa.github.io/cumulus/docs/additional-deployment-options/cloudwatch-logs-delivery#esdis-metrics)
      in your environment
  - Added `@cumulus/api/models/Granule.getRecord()` method to return raw record
    from DynamoDB
  - Added `@cumulus/api/models/Granule.delete()` method which handles deleting
    the granule record from DynamoDB and the granule files from S3
- **CUMULUS-1982**
  - The `globalConnectionLimit` property of providers is now optional and
    defaults to "unlimited"
- **CUMULUS-1997**
  - Added optional `launchpad` configuration to `@cumulus/hyrax-metadata-updates` task config schema.
- **CUMULUS-1991**
  - `@cumulus/cmrjs/src/cmr-utils/constructOnlineAccessUrls()` now throws an error if `cmrGranuleUrlType = "distribution"` and no distribution endpoint argument is provided
- **CUMULUS-2011**
  - Reconciliation reports are now generated within an AsyncOperation
- **CUMULUS-2016**
  - Upgrade TEA to version 79

### Fixed

- **CUMULUS-1991**
  - Added missing `DISTRIBUTION_ENDPOINT` environment variable for API lambdas. This environment variable is required for API requests to move granules.

- **CUMULUS-1961**
  - Fixed granules and executions query params not getting sent to API in granule list operation in `@cumulus/api-client`

### Deprecated

- `@cumulus/aws-client/S3.calculateS3ObjectChecksum()`
- `@cumulus/aws-client/S3.getS3ObjectReadStream()`
- `@cumulus/common/log.convertLogLevel()`
- `@cumulus/collection-config-store`
- `@cumulus/common/util.sleep()`

- **CUMULUS-1930**
  - `@cumulus/common/log.convertLogLevel()`
  - `@cumulus/common/util.isNull()`
  - `@cumulus/common/util.isUndefined()`
  - `@cumulus/common/util.negate()`
  - `@cumulus/common/util.noop()`
  - `@cumulus/common/util.isNil()`
  - `@cumulus/common/util.renameProperty()`
  - `@cumulus/common/util.lookupMimeType()`
  - `@cumulus/common/util.thread()`
  - `@cumulus/common/util.mkdtempSync()`

### Removed

- The deprecated `@cumulus/common.bucketsConfigJsonObject` function has been
  removed
- The deprecated `@cumulus/common.CollectionConfigStore` class has been removed
- The deprecated `@cumulus/common.concurrency` module has been removed
- The deprecated `@cumulus/common.constructCollectionId` function has been
  removed
- The deprecated `@cumulus/common.launchpad` module has been removed
- The deprecated `@cumulus/common.LaunchpadToken` class has been removed
- The deprecated `@cumulus/common.Semaphore` class has been removed
- The deprecated `@cumulus/common.stringUtils` module has been removed
- The deprecated `@cumulus/common/aws.cloudwatchlogs` function has been removed
- The deprecated `@cumulus/common/aws.deleteS3Files` function has been removed
- The deprecated `@cumulus/common/aws.deleteS3Object` function has been removed
- The deprecated `@cumulus/common/aws.dynamodb` function has been removed
- The deprecated `@cumulus/common/aws.dynamodbDocClient` function has been
  removed
- The deprecated `@cumulus/common/aws.getExecutionArn` function has been removed
- The deprecated `@cumulus/common/aws.headObject` function has been removed
- The deprecated `@cumulus/common/aws.listS3ObjectsV2` function has been removed
- The deprecated `@cumulus/common/aws.parseS3Uri` function has been removed
- The deprecated `@cumulus/common/aws.promiseS3Upload` function has been removed
- The deprecated `@cumulus/common/aws.recursivelyDeleteS3Bucket` function has
  been removed
- The deprecated `@cumulus/common/aws.s3CopyObject` function has been removed
- The deprecated `@cumulus/common/aws.s3ObjectExists` function has been removed
- The deprecated `@cumulus/common/aws.s3PutObject` function has been removed
- The deprecated `@cumulus/common/bucketsConfigJsonObject` function has been
  removed
- The deprecated `@cumulus/common/CloudWatchLogger` class has been removed
- The deprecated `@cumulus/common/collection-config-store.CollectionConfigStore`
  class has been removed
- The deprecated `@cumulus/common/collection-config-store.constructCollectionId`
  function has been removed
- The deprecated `@cumulus/common/concurrency.limit` function has been removed
- The deprecated `@cumulus/common/concurrency.mapTolerant` function has been
  removed
- The deprecated `@cumulus/common/concurrency.promiseUrl` function has been
  removed
- The deprecated `@cumulus/common/concurrency.toPromise` function has been
  removed
- The deprecated `@cumulus/common/concurrency.unless` function has been removed
- The deprecated `@cumulus/common/config.parseConfig` function has been removed
- The deprecated `@cumulus/common/config.resolveResource` function has been
  removed
- The deprecated `@cumulus/common/DynamoDb.get` function has been removed
- The deprecated `@cumulus/common/DynamoDb.scan` function has been removed
- The deprecated `@cumulus/common/FieldPattern` class has been removed
- The deprecated `@cumulus/common/launchpad.getLaunchpadToken` function has been
  removed
- The deprecated `@cumulus/common/launchpad.validateLaunchpadToken` function has
  been removed
- The deprecated `@cumulus/common/LaunchpadToken` class has been removed
- The deprecated `@cumulus/common/message.buildCumulusMeta` function has been
  removed
- The deprecated `@cumulus/common/message.buildQueueMessageFromTemplate`
  function has been removed
- The deprecated `@cumulus/common/message.getCollectionIdFromMessage` function
  has been removed
- The deprecated `@cumulus/common/message.getMaximumExecutions` function has
  been removed
- The deprecated `@cumulus/common/message.getMessageExecutionArn` function has
  been removed
- The deprecated `@cumulus/common/message.getMessageExecutionName` function has
  been removed
- The deprecated `@cumulus/common/message.getMessageFromTemplate` function has
  been removed
- The deprecated `@cumulus/common/message.getMessageGranules` function has been
  removed
- The deprecated `@cumulus/common/message.getMessageStateMachineArn` function
  has been removed
- The deprecated `@cumulus/common/message.getQueueName` function has been
  removed
- The deprecated `@cumulus/common/message.getQueueNameByUrl` function has been
  removed
- The deprecated `@cumulus/common/message.hasQueueAndExecutionLimit` function
  has been removed
- The deprecated `@cumulus/common/Semaphore` class has been removed
- The deprecated `@cumulus/common/string.globalReplace` function has been removed
- The deprecated `@cumulus/common/string.isNonEmptyString` function has been
  removed
- The deprecated `@cumulus/common/string.isValidHostname` function has been
  removed
- The deprecated `@cumulus/common/string.match` function has been removed
- The deprecated `@cumulus/common/string.matches` function has been removed
- The deprecated `@cumulus/common/string.replace` function has been removed
- The deprecated `@cumulus/common/string.toLower` function has been removed
- The deprecated `@cumulus/common/string.toUpper` function has been removed
- The deprecated `@cumulus/common/testUtils.getLocalstackEndpoint` function has been removed
- The deprecated `@cumulus/common/util.setErrorStack` function has been removed
- The `@cumulus/common/util.uuid` function has been removed
- The deprecated `@cumulus/common/workflows.getWorkflowArn` function has been
  removed
- The deprecated `@cumulus/common/workflows.getWorkflowFile` function has been
  removed
- The deprecated `@cumulus/common/workflows.getWorkflowList` function has been
  removed
- The deprecated `@cumulus/common/workflows.getWorkflowTemplate` function has
  been removed
- `@cumulus/aws-client/StepFunctions.toSfnExecutionName()`
- `@cumulus/aws-client/StepFunctions.fromSfnExecutionName()`
- `@cumulus/aws-client/StepFunctions.getExecutionArn()`
- `@cumulus/aws-client/StepFunctions.getExecutionUrl()`
- `@cumulus/aws-client/StepFunctions.getStateMachineArn()`
- `@cumulus/aws-client/StepFunctions.pullStepFunctionEvent()`
- `@cumulus/common/test-utils/throttleOnce()`
- `@cumulus/integration-tests/api/distribution.invokeApiDistributionLambda()`
- `@cumulus/integration-tests/api/distribution.getDistributionApiRedirect()`
- `@cumulus/integration-tests/api/distribution.getDistributionApiFileStream()`

## [v1.24.0] 2020-06-03

### BREAKING CHANGES

- **CUMULUS-1969**
  - The `DiscoverPdrs` task now expects `provider_path` to be provided at
    `event.config.provider_path`, not `event.config.collection.provider_path`
  - `event.config.provider_path` is now a required parameter of the
    `DiscoverPdrs` task
  - `event.config.collection` is no longer a parameter to the `DiscoverPdrs`
    task
  - Collections no longer support the `provider_path` property. The tasks that
    relied on that property are now referencing `config.meta.provider_path`.
    Workflows should be updated accordingly.

- **CUMULUS-1997**
  - `@cumulus/cmr-client/CMRSearchConceptQueue` parameters have been changed to take a `cmrSettings` object containing clientId, provider, and auth information. This can be generated using `@cumulus/cmrjs/cmr-utils/getCmrSettings`. The `cmrEnvironment` variable has been removed.

### Added

- **CUMULUS-1800**
  - Added task configuration setting named `syncChecksumFiles` to the
    SyncGranule task. This setting is `false` by default, but when set to
    `true`, all checksum files associated with data files that are downloaded
    will be downloaded as well.
- **CUMULUS-1952**
  - Updated HTTP(S) provider client to accept username/password for Basic authorization. This change adds support for Basic Authorization such as Earthdata login redirects to ingest (i.e. as implemented in SyncGranule), but not to discovery (i.e. as implemented in DiscoverGranules). Discovery still expects the provider's file system to be publicly accessible, but not the individual files and their contents.
  - **NOTE**: Using this in combination with the HTTP protocol may expose usernames and passwords to intermediary network entities. HTTPS is highly recommended.
- **CUMULUS-1997**
  - Added optional `launchpad` configuration to `@cumulus/hyrax-metadata-updates` task config schema.

### Fixed

- **CUMULUS-1997**
  - Updated all CMR operations to use configured authentication scheme
- **CUMULUS-2010**
  - Updated `@cumulus/api/launchpadSaml` to support multiple userGroup attributes from the SAML response

## [v1.23.2] 2020-05-22

### BREAKING CHANGES

- Updates to the Cumulus archive API:
  - All endpoints now return a `401` response instead of a `403` for any request where the JWT passed as a Bearer token is invalid.
  - POST `/refresh` and DELETE `/token/<token>` endpoints now return a `401` response for requests with expired tokens

- **CUMULUS-1894**
  - `@cumulus/ingest/granule.handleDuplicateFile()`
    - The `copyOptions` parameter has been removed
    - An `ACL` parameter has been added
  - `@cumulus/ingest/granule.renameS3FileWithTimestamp()`
    - Now returns `undefined`

- **CUMULUS-1896**
  Updated all Cumulus core lambdas to utilize the new message adapter streaming interface via [cumulus-message-adapter-js v1.2.0](https://github.com/nasa/cumulus-message-adapter-js/releases/tag/v1.2.0).   Users of this version of Cumulus (or later) must utilize version 1.3.0 or greater of the [cumulus-message-adapter](https://github.com/nasa/cumulus-message-adapter) to support core lambdas.

- **CUMULUS-1912**
  - `@cumulus/api` reconciliationReports list endpoint returns a list of reconciliationReport records instead of S3Uri.

- **CUMULUS-1969**
  - The `DiscoverGranules` task now expects `provider_path` to be provided at
    `event.config.provider_path`, not `event.config.collection.provider_path`
  - `config.provider_path` is now a required parameter of the `DiscoverGranules`
    task

### MIGRATION STEPS

- To take advantage of the new TTL-based access token expiration implemented in CUMULUS-1777 (see notes below) and clear out existing records in your access tokens table, do the following:
  1. Log out of any active dashboard sessions
  2. Use the AWS console or CLI to delete your `<prefix>-AccessTokensTable` DynamoDB table
  3. [Re-deploy your `data-persistence` module](https://nasa.github.io/cumulus/docs/deployment/upgrade-readme#update-data-persistence-resources), which should re-create the `<prefix>-AccessTokensTable` DynamoDB table
  4. Return to using the Cumulus API/dashboard as normal
- This release requires the Cumulus Message Adapter layer deployed with Cumulus Core to be at least 1.3.0, as the core lambdas have updated to [cumulus-message-adapter-js v1.2.0](https://github.com/nasa/cumulus-message-adapter-js/releases/tag/v1.2.0) and the new CMA interface.  As a result, users should:
  1. Follow the [Cumulus Message Adapter (CMA) deployment instructions](https://nasa.github.io/cumulus/docs/deployment/deployment-readme#deploy-the-cumulus-message-adapter-layer) and install a CMA layer version >=1.3.0
  2. If you are using any custom Node.js Lambdas in your workflows **and** the Cumulus CMA layer/`cumulus-message-adapter-js`, you must update your lambda to use [cumulus-message-adapter-js v1.2.0](https://github.com/nasa/cumulus-message-adapter-js/releases/tag/v1.2.0) and follow the migration instructions in the release notes. Prior versions of `cumulus-message-adapter-js` are not compatible with CMA >= 1.3.0.
- Migrate existing s3 reconciliation report records to database (CUMULUS-1911):
  - After update your `data persistence` module and Cumulus resources, run the command:

  ```bash
  ./node_modules/.bin/cumulus-api migrate --stack `<your-terraform-deployment-prefix>` --migrationVersion migration5
  ```

### Added

- Added a limit for concurrent Elasticsearch requests when doing an index from database operation
- Added the `es_request_concurrency` parameter to the archive and cumulus Terraform modules

- **CUMULUS-1995**
  - Added the `es_index_shards` parameter to the archive and cumulus Terraform modules to configure the number of shards for the ES index
    - If you have an existing ES index, you will need to [reindex](https://nasa.github.io/cumulus-api/#reindex) and then [change index](https://nasa.github.io/cumulus-api/#change-index) to take advantage of shard updates

- **CUMULUS-1894**
  - Added `@cumulus/aws-client/S3.moveObject()`

- **CUMULUS-1911**
  - Added ReconciliationReports table
  - Updated CreateReconciliationReport lambda to save Reconciliation Report records to database
  - Updated dbIndexer and IndexFromDatabase lambdas to index Reconciliation Report records to Elasticsearch
  - Added migration_5 to migrate existing s3 reconciliation report records to database and Elasticsearch
  - Updated `@cumulus/api` package, `tf-modules/archive` and `tf-modules/data-persistence` Terraform modules

- **CUMULUS-1916**
  - Added util function for seeding reconciliation reports when running API locally in dashboard

### Changed

- **CUMULUS-1777**
  - The `expirationTime` property is now a **required field** of the access tokens model.
  - Updated the `AccessTokens` table to set a [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html) on the `expirationTime` field in `tf-modules/data-persistence/dynamo.tf`. As a result, access token records in this table whose `expirationTime` has passed should be **automatically deleted by DynamoDB**.
  - Updated all code creating access token records in the Dynamo `AccessTokens` table to set the `expirationTime` field value in seconds from the epoch.
- **CUMULUS-1912**
  - Updated reconciliationReports endpoints to query against Elasticsearch, delete report from both database and s3
  - Added `@cumulus/api-client/reconciliationReports`
- **CUMULUS-1999**
  - Updated `@cumulus/common/util.deprecate()` so that only a single deprecation notice is printed for each name/version combination

### Fixed

- **CUMULUS-1894**
  - The `SyncGranule` task can now handle files larger than 5 GB
- **CUMULUS-1987**
  - `Remove granule from CMR` operation in `@cumulus/api` now passes token to CMR when fetching granule metadata, allowing removal of private granules
- **CUMULUS-1993**
  - For a given queue, the `sqs-message-consumer` Lambda will now only schedule workflows for rules matching the queue **and the collection information in each queue message (if any)**
    - The consumer also now only reads each queue message **once per Lambda invocation**, whereas previously each message was read **once per queue rule per Lambda invocation**
  - Fixed bug preventing the deletion of multiple SNS rules that share the same SNS topic

### Deprecated

- **CUMULUS-1894**
  - `@cumulus/ingest/granule.copyGranuleFile()`
  - `@cumulus/ingest/granule.moveGranuleFile()`

- **CUMULUS-1987** - Deprecated the following functions:
  - `@cumulus/cmrjs/getMetadata(cmrLink)` -> `@cumulus/cmr-client/CMR.getGranuleMetadata(cmrLink)`
  - `@cumulus/cmrjs/getFullMetadata(cmrLink)`

## [v1.22.1] 2020-05-04

**Note**: v1.22.0 was not released as a package due to npm/release concerns.  Users upgrading to 1.22.x should start with 1.22.1

### Added

- **CUMULUS-1894**
  - Added `@cumulus/aws-client/S3.multipartCopyObject()`
- **CUMULUS-408**
  - Added `certificateUri` field to provider schema. This optional field allows operators to specify an S3 uri to a CA bundle to use for HTTPS requests.
- **CUMULUS-1787**
  - Added `collections/active` endpoint for returning collections with active granules in `@cumulus/api`
- **CUMULUS-1799**
  - Added `@cumulus/common/stack.getBucketsConfigKey()` to return the S3 key for the buckets config object
  - Added `@cumulus/common/workflows.getWorkflowFileKey()` to return the S3 key for a workflow definition object
  - Added `@cumulus/common/workflows.getWorkflowsListKeyPrefix()` to return the S3 key prefix for objects containing workflow definitions
  - Added `@cumulus/message` package containing utilities for building and parsing Cumulus messages
- **CUMULUS-1850**
  - Added `@cumulus/aws-client/Kinesis.describeStream()` to get a Kinesis stream description
- **CUMULUS-1853**
  - Added `@cumulus/integration-tests/collections.createCollection()`
  - Added `@cumulus/integration-tests/executions.findExecutionArn()`
  - Added `@cumulus/integration-tests/executions.getExecutionWithStatus()`
  - Added `@cumulus/integration-tests/granules.getGranuleWithStatus()`
  - Added `@cumulus/integration-tests/providers.createProvider()`
  - Added `@cumulus/integration-tests/rules.createOneTimeRule()`

### Changed

- **CUMULUS-1682**
  - Moved all `@cumulus/ingest/parse-pdr` code into the `parse-pdr` task as it had become tightly coupled with that task's handler and was not used anywhere else. Unit tests also restored.
- **CUMULUS-1820**
  - Updated the Thin Egress App module used in `tf-modules/distribution/main.tf` to build 74. [See the release notes](https://github.com/asfadmin/thin-egress-app/releases/tag/tea-build.74).
- **CUMULUS-1852**
  - Updated POST endpoints for `/collections`, `/providers`, and `/rules` to log errors when returning a 500 response
  - Updated POST endpoint for `/collections`:
    - Return a 400 response when the `name` or `version` fields are missing
    - Return a 409 response if the collection already exists
    - Improved error messages to be more explicit
  - Updated POST endpoint for `/providers`:
    - Return a 400 response if the `host` field value is invalid
    - Return a 409 response if the provider already exists
  - Updated POST endpoint for `/rules`:
    - Return a 400 response if rule `name` is invalid
    - Return a 400 response if rule `type` is invalid
- **CUMULUS-1891**
  - Updated the following endpoints using async operations to return a 503 error if the ECS task  cannot be started and a 500 response for a non-specific error:
    - POST `/replays`
    - POST `/bulkDelete`
    - POST `/elasticsearch/index-from-database`
    - POST `/granules/bulk`

### Fixed

- **CUMULUS-408**
  - Fixed HTTPS discovery and ingest.

- **CUMULUS-1850**
  - Fixed a bug in Kinesis event processing where the message consumer would not properly filter available rules based on the collection information in the event and the Kinesis stream ARN

- **CUMULUS-1853**
  - Fixed a bug where attempting to create a rule containing a payload property
    would fail schema validation.

- **CUMULUS-1854**
  - Rule schema is validated before starting workflows or creating event source mappings

- **CUMULUS-1974**
  - Fixed @cumulus/api webpack config for missing underscore object due to underscore update

- **CUMULUS-2210**
  - Fixed `cmr_oauth_provider` variable not being propagated to reconciliation reports

### Deprecated

- **CUMULUS-1799** - Deprecated the following code. For cases where the code was moved into another package, the new code location is noted:
  - `@cumulus/aws-client/StepFunctions.fromSfnExecutionName()`
  - `@cumulus/aws-client/StepFunctions.toSfnExecutionName()`
  - `@cumulus/aws-client/StepFunctions.getExecutionArn()` -> `@cumulus/message/Executions.buildExecutionArn()`
  - `@cumulus/aws-client/StepFunctions.getExecutionUrl()` -> `@cumulus/message/Executions.getExecutionUrlFromArn()`
  - `@cumulus/aws-client/StepFunctions.getStateMachineArn()` -> `@cumulus/message/Executions.getStateMachineArnFromExecutionArn()`
  - `@cumulus/aws-client/StepFunctions.pullStepFunctionEvent()` -> `@cumulus/message/StepFunctions.pullStepFunctionEvent()`
  - `@cumulus/common/bucketsConfigJsonObject()`
  - `@cumulus/common/CloudWatchLogger`
  - `@cumulus/common/collection-config-store/CollectionConfigStore` -> `@cumulus/collection-config-store`
  - `@cumulus/common/collection-config-store.constructCollectionId()` -> `@cumulus/message/Collections.constructCollectionId`
  - `@cumulus/common/concurrency.limit()`
  - `@cumulus/common/concurrency.mapTolerant()`
  - `@cumulus/common/concurrency.promiseUrl()`
  - `@cumulus/common/concurrency.toPromise()`
  - `@cumulus/common/concurrency.unless()`
  - `@cumulus/common/config.buildSchema()`
  - `@cumulus/common/config.parseConfig()`
  - `@cumulus/common/config.resolveResource()`
  - `@cumulus/common/config.resourceToArn()`
  - `@cumulus/common/FieldPattern`
  - `@cumulus/common/launchpad.getLaunchpadToken()` -> `@cumulus/launchpad-auth/index.getLaunchpadToken()`
  - `@cumulus/common/LaunchpadToken` -> `@cumulus/launchpad-auth/LaunchpadToken`
  - `@cumulus/common/launchpad.validateLaunchpadToken()` -> `@cumulus/launchpad-auth/index.validateLaunchpadToken()`
  - `@cumulus/common/message.buildCumulusMeta()` -> `@cumulus/message/Build.buildCumulusMeta()`
  - `@cumulus/common/message.buildQueueMessageFromTemplate()` -> `@cumulus/message/Build.buildQueueMessageFromTemplate()`
  - `@cumulus/common/message.getCollectionIdFromMessage()` -> `@cumulus/message/Collections.getCollectionIdFromMessage()`
  - `@cumulus/common/message.getMessageExecutionArn()` -> `@cumulus/message/Executions.getMessageExecutionArn()`
  - `@cumulus/common/message.getMessageExecutionName()` -> `@cumulus/message/Executions.getMessageExecutionName()`
  - `@cumulus/common/message.getMaximumExecutions()` -> `@cumulus/message/Queue.getMaximumExecutions()`
  - `@cumulus/common/message.getMessageFromTemplate()`
  - `@cumulus/common/message.getMessageStateMachineArn()` -> `@cumulus/message/Executions.getMessageStateMachineArn()`)
  - `@cumulus/common/message.getMessageGranules()` -> `@cumulus/message/Granules.getMessageGranules()`
  - `@cumulus/common/message.getQueueNameByUrl()` -> `@cumulus/message/Queue.getQueueNameByUrl()`
  - `@cumulus/common/message.getQueueName()` -> `@cumulus/message/Queue.getQueueName()`)
  - `@cumulus/common/message.hasQueueAndExecutionLimit()` -> `@cumulus/message/Queue.hasQueueAndExecutionLimit()`
  - `@cumulus/common/Semaphore`
  - `@cumulus/common/test-utils.throttleOnce()`
  - `@cumulus/common/workflows.getWorkflowArn()`
  - `@cumulus/common/workflows.getWorkflowFile()`
  - `@cumulus/common/workflows.getWorkflowList()`
  - `@cumulus/common/workflows.getWorkflowTemplate()`
  - `@cumulus/integration-tests/sfnStep/SfnStep.parseStepMessage()` -> `@cumulus/message/StepFunctions.parseStepMessage()`
- **CUMULUS-1858** - Deprecated the following functions.
  - `@cumulus/common/string.globalReplace()`
  - `@cumulus/common/string.isNonEmptyString()`
  - `@cumulus/common/string.isValidHostname()`
  - `@cumulus/common/string.match()`
  - `@cumulus/common/string.matches()`
  - `@cumulus/common/string.replace()`
  - `@cumulus/common/string.toLower()`
  - `@cumulus/common/string.toUpper()`

### Removed

- **CUMULUS-1799**: Deprecated code removals:
  - Removed from `@cumulus/common/aws`:
    - `pullStepFunctionEvent()`
  - Removed `@cumulus/common/sfnStep`
  - Removed `@cumulus/common/StepFunctions`

## [v1.21.0] 2020-03-30

### PLEASE NOTE

- **CUMULUS-1762**: the `messageConsumer` for `sns` and `kinesis`-type rules now fetches
  the collection information from the message. You should ensure that your rule's collection
  name and version match what is in the message for these ingest messages to be processed.
  If no matching rule is found, an error will be thrown and logged in the
  `messageConsumer` Lambda function's log group.

### Added

- **CUMULUS-1629**`
  - Updates discover-granules task to respect/utilize duplicateHandling configuration such that
    - skip:               Duplicates will be filtered from the granule list
    - error:              Duplicates encountered will result in step failure
    - replace, version:   Duplicates will be ignored and handled as normal.
  - Adds a new copy of the API lambda `PrivateApiLambda()` which is configured to not require authentication. This Lambda is not connected to an API gateway
  - Adds `@cumulus/api-client` with functions for use by workflow lambdas to call the API when needed

- **CUMULUS-1732**
  - Added Python task/activity workflow and integration test (`PythonReferenceSpec`) to test `cumulus-message-adapter-python`and `cumulus-process-py` integration.
- **CUMULUS-1795**
  - Added an IAM policy on the Cumulus EC2 creation to enable SSM when the `deploy_to_ngap` flag is true

### Changed

- **CUMULUS-1762**
  - the `messageConsumer` for `sns` and `kinesis`-type rules now fetches the collection
    information from the message.

### Deprecated

- **CUMULUS-1629**
  - Deprecate `granulesApi`, `rulesApi`, `emsApi`, `executionsAPI` from `@cumulus/integration-test/api` in favor of code moved to `@cumulus/api-client`

### Removed

- **CUMULUS-1799**: Deprecated code removals
  - Removed deprecated method `@cumulus/api/models/Granule.createGranulesFromSns()`
  - Removed deprecated method `@cumulus/api/models/Granule.removeGranuleFromCmr()`
  - Removed from `@cumulus/common/aws`:
    - `apigateway()`
    - `buildS3Uri()`
    - `calculateS3ObjectChecksum()`
    - `cf()`
    - `cloudwatch()`
    - `cloudwatchevents()`
    - `cloudwatchlogs()`
    - `createAndWaitForDynamoDbTable()`
    - `createQueue()`
    - `deleteSQSMessage()`
    - `describeCfStackResources()`
    - `downloadS3File()`
    - `downloadS3Files()`
    - `DynamoDbSearchQueue` class
    - `dynamodbstreams()`
    - `ec2()`
    - `ecs()`
    - `fileExists()`
    - `findResourceArn()`
    - `fromSfnExecutionName()`
    - `getFileBucketAndKey()`
    - `getJsonS3Object()`
    - `getQueueUrl()`
    - `getObjectSize()`
    - `getS3ObjectReadStream()`
    - `getSecretString()`
    - `getStateMachineArn()`
    - `headObject()`
    - `isThrottlingException()`
    - `kinesis()`
    - `lambda()`
    - `listS3Objects()`
    - `promiseS3Upload()`
    - `publishSnsMessage()`
    - `putJsonS3Object()`
    - `receiveSQSMessages()`
    - `s3CopyObject()`
    - `s3GetObjectTagging()`
    - `s3Join()`
    - `S3ListObjectsV2Queue` class
    - `s3TagSetToQueryString()`
    - `s3PutObjectTagging()`
    - `secretsManager()`
    - `sendSQSMessage()`
    - `sfn()`
    - `sns()`
    - `sqs()`
    - `sqsQueueExists()`
    - `toSfnExecutionName()`
    - `uploadS3FileStream()`
    - `uploadS3Files()`
    - `validateS3ObjectChecksum()`
  - Removed `@cumulus/common/CloudFormationGateway` class
  - Removed `@cumulus/common/concurrency/Mutex` class
  - Removed `@cumulus/common/errors`
  - Removed `@cumulus/common/sftp`
  - Removed `@cumulus/common/string.unicodeEscape`
  - Removed `@cumulus/cmrjs/cmr-utils.getGranuleId()`
  - Removed `@cumulus/cmrjs/cmr-utils.getCmrFiles()`
  - Removed `@cumulus/cmrjs/cmr/CMR` class
  - Removed `@cumulus/cmrjs/cmr/CMRSearchConceptQueue` class
  - Removed `@cumulus/cmrjs/utils.getHost()`
  - Removed `@cumulus/cmrjs/utils.getIp()`
  - Removed `@cumulus/cmrjs/utils.hostId()`
  - Removed `@cumulus/cmrjs/utils/ummVersion()`
  - Removed `@cumulus/cmrjs/utils.updateToken()`
  - Removed `@cumulus/cmrjs/utils.validateUMMG()`
  - Removed `@cumulus/ingest/aws.getEndpoint()`
  - Removed `@cumulus/ingest/aws.getExecutionUrl()`
  - Removed `@cumulus/ingest/aws/invoke()`
  - Removed `@cumulus/ingest/aws/CloudWatch` class
  - Removed `@cumulus/ingest/aws/ECS` class
  - Removed `@cumulus/ingest/aws/Events` class
  - Removed `@cumulus/ingest/aws/SQS` class
  - Removed `@cumulus/ingest/aws/StepFunction` class
  - Removed `@cumulus/ingest/util.normalizeProviderPath()`
  - Removed `@cumulus/integration-tests/index.listCollections()`
  - Removed `@cumulus/integration-tests/index.listProviders()`
  - Removed `@cumulus/integration-tests/index.rulesList()`
  - Removed `@cumulus/integration-tests/api/api.addCollectionApi()`

## [v1.20.0] 2020-03-12

### BREAKING CHANGES

- **CUMULUS-1714**
  - Changed the format of the message sent to the granule SNS Topic. Message includes the granule record under `record` and the type of event under `event`. Messages with `deleted` events will have the record that was deleted with a `deletedAt` timestamp. Options for `event` are `Create | Update | Delete`
- **CUMULUS-1769** - `deploy_to_ngap` is now a **required** variable for the `tf-modules/cumulus` module. **For those deploying to NGAP environments, this variable should always be set to `true`.**

### Notable changes

- **CUMULUS-1739** - You can now exclude Elasticsearch from your `tf-modules/data-persistence` deployment (via `include_elasticsearch = false`) and your `tf-modules/cumulus` module will still deploy successfully.

- **CUMULUS-1769** - If you set `deploy_to_ngap = true` for the `tf-modules/archive` Terraform module, **you can only deploy your archive API gateway as `PRIVATE`**, not `EDGE`.

### Added

- Added `@cumulus/aws-client/S3.getS3ObjectReadStreamAsync()` to deal with S3 eventual consistency issues by checking for the existence an S3 object with retries before getting a readable stream for that object.
- **CUMULUS-1769**
  - Added `deploy_to_ngap` boolean variable for the `tf-modules/cumulus` and `tf-modules/archive` Terraform modules. This variable is required. **For those deploying to NGAP environments, this variable should always be set to `true`.**
- **HYRAX-70**
  - Add the hyrax-metadata-update task

### Changed

- [`AccessToken.get()`](https://github.com/nasa/cumulus/blob/master/packages/api/models/access-tokens.js) now enforces [strongly consistent reads from DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- **CUMULUS-1739**
  - Updated `tf-modules/data-persistence` to make Elasticsearch alarm resources and outputs conditional on the `include_elasticsearch` variable
  - Updated `@cumulus/aws-client/S3.getObjectSize` to include automatic retries for any failures from `S3.headObject`
- **CUMULUS-1784**
  - Updated `@cumulus/api/lib/DistributionEvent.remoteIP()` to parse the IP address in an S3 access log from the `A-sourceip` query parameter if present, otherwise fallback to the original parsing behavior.
- **CUMULUS-1768**
  - The `stats/summary` endpoint reports the distinct collections for the number of granules reported

### Fixed

- **CUMULUS-1739** - Fixed the `tf-modules/cumulus` and `tf-modules/archive` modules to make these Elasticsearch variables truly optional:
  - `elasticsearch_domain_arn`
  - `elasticsearch_hostname`
  - `elasticsearch_security_group_id`

- **CUMULUS-1768**
  - Fixed the `stats/` endpoint so that data is correctly filtered by timestamp and `processingTime` is calculated correctly.

- **CUMULUS-1769**
  - In the `tf-modules/archive` Terraform module, the `lifecycle` block ignoring changes to the `policy` of the archive API gateway is now only enforced if `deploy_to_ngap = true`. This fixes a bug where users deploying outside of NGAP could not update their API gateway's resource policy when going from `PRIVATE` to `EDGE`, preventing their API from being accessed publicly.

- **CUMULUS-1775**
  - Fix/update api endpoint to use updated google auth endpoints such that it will work with new accounts

### Removed

- **CUMULUS-1768**
  - Removed API endpoints `stats/histogram` and `stats/average`. All advanced stats needs should be acquired from Cloud Metrics or similarly configured ELK stack.

## [v1.19.0] 2020-02-28

### BREAKING CHANGES

- **CUMULUS-1736**
  - The `@cumulus/discover-granules` task now sets the `dataType` of discovered
    granules based on the `name` of the configured collection, not the
    `dataType`.
  - The config schema of the `@cumulus/discover-granules` task now requires that
    collections contain a `version`.
  - The `@cumulus/sync-granule` task will set the `dataType` and `version` of a
    granule based on the configured collection if those fields are not already
    set on the granule. Previously it was using the `dataType` field of the
    configured collection, then falling back to the `name` field of the
    collection. This update will just use the `name` field of the collection to
    set the `dataType` field of the granule.

- **CUMULUS-1446**
  - Update the `@cumulus/integration-tests/api/executions.getExecution()`
    function to parse the response and return the execution, rather than return
    the full API response.

- **CUMULUS-1672**
  - The `cumulus` Terraform module in previous releases set a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, a `tags` input variable has been added to the `cumulus` Terraform
    module to allow resource tagging to be customized. No default tags will be
    applied to Cumulus-managed resources. To replicate the previous behavior,
    set `tags = { Deployment: var.prefix }` as an input variable for the
    `cumulus` Terraform module.

- **CUMULUS-1684 Migration Instructions**
  - In previous releases, a provider's username and password were encrypted
    using a custom encryption library. That has now been updated to use KMS.
    This release includes a Lambda function named
    `<prefix>-ProviderSecretsMigration`, which will re-encrypt existing
    provider credentials to use KMS. After this release has been deployed, you
    will need to manually invoke that Lambda function using either the AWS CLI
    or AWS Console. It should only need to be successfully run once.
  - Future releases of Cumulus will invoke a
    `<prefix>-VerifyProviderSecretsMigration` Lambda function as part of the
    deployment, which will cause the deployment to fail if the migration
    Lambda has not been run.

- **CUMULUS-1718**
  - The `@cumulus/sf-sns-report` task for reporting mid-workflow updates has been retired.
  This task was used as the `PdrStatusReport` task in our ParsePdr example workflow.
  If you have a ParsePdr or other workflow using this task, use `@cumulus/sf-sqs-report` instead.
  Trying to deploy the old task will result in an error as the cumulus module no longer exports `sf_sns_report_task`.
  - Migration instruction: In your workflow definition, for each step using the old task change:
  `"Resource": "${module.cumulus.sf_sns_report_task.task_arn}"`
  to
  `"Resource": "${module.cumulus.sf_sqs_report_task.task_arn}"`

- **CUMULUS-1755**
  - The `thin_egress_jwt_secret_name` variable for the `tf-modules/cumulus` Terraform module is now **required**. This variable is passed on to the Thin Egress App in `tf-modules/distribution/main.tf`, which uses the keys stored in the secret to sign JWTs. See the [Thin Egress App documentation on how to create a value for this secret](https://github.com/asfadmin/thin-egress-app#setting-up-the-jwt-cookie-secrets).

### Added

- **CUMULUS-1446**
  - Add `@cumulus/common/FileUtils.readJsonFile()` function
  - Add `@cumulus/common/FileUtils.readTextFile()` function
  - Add `@cumulus/integration-tests/api/collections.createCollection()` function
  - Add `@cumulus/integration-tests/api/collections.deleteCollection()` function
  - Add `@cumulus/integration-tests/api/collections.getCollection()` function
  - Add `@cumulus/integration-tests/api/providers.getProvider()` function
  - Add `@cumulus/integration-tests/index.getExecutionOutput()` function
  - Add `@cumulus/integration-tests/index.loadCollection()` function
  - Add `@cumulus/integration-tests/index.loadProvider()` function
  - Add `@cumulus/integration-tests/index.readJsonFilesFromDir()` function

- **CUMULUS-1672**
  - Add a `tags` input variable to the `archive` Terraform module
  - Add a `tags` input variable to the `cumulus` Terraform module
  - Add a `tags` input variable to the `cumulus_ecs_service` Terraform module
  - Add a `tags` input variable to the `data-persistence` Terraform module
  - Add a `tags` input variable to the `distribution` Terraform module
  - Add a `tags` input variable to the `ingest` Terraform module
  - Add a `tags` input variable to the `s3-replicator` Terraform module

- **CUMULUS-1707**
  - Enable logrotate on ECS cluster

- **CUMULUS-1684**
  - Add a `@cumulus/aws-client/KMS` library of KMS-related functions
  - Add `@cumulus/aws-client/S3.getTextObject()`
  - Add `@cumulus/sftp-client` package
  - Create `ProviderSecretsMigration` Lambda function
  - Create `VerifyProviderSecretsMigration` Lambda function

- **CUMULUS-1548**
  - Add ability to put default Cumulus logs in Metrics' ELK stack
  - Add ability to add custom logs to Metrics' ELK Stack

- **CUMULUS-1702**
  - When logs are sent to Metrics' ELK stack, the logs endpoints will return results from there

- **CUMULUS-1459**
  - Async Operations are indexed in Elasticsearch
  - To index any existing async operations you'll need to perform an index from
    database function.

- **CUMULUS-1717**
  - Add `@cumulus/aws-client/deleteAndWaitForDynamoDbTableNotExists`, which
    deletes a DynamoDB table and waits to ensure the table no longer exists
  - Added `publishGranules` Lambda to handle publishing granule messages to SNS when granule records are written to DynamoDB
  - Added `@cumulus/api/models/Granule.storeGranulesFromCumulusMessage` to store granules from a Cumulus message to DynamoDB

- **CUMULUS-1718**
  - Added `@cumulus/sf-sqs-report` task to allow mid-workflow reporting updates.
  - Added `stepfunction_event_reporter_queue_url` and `sf_sqs_report_task` outputs to the `cumulus` module.
  - Added `publishPdrs` Lambda to handle publishing PDR messages to SNS when PDR records are written to DynamoDB.
  - Added `@cumulus/api/models/Pdr.storePdrFromCumulusMessage` to store PDRs from a Cumulus message to DynamoDB.
  - Added `@cumulus/aws-client/parseSQSMessageBody` to parse an SQS message body string into an object.

- **Ability to set custom backend API url in the archive module**
  - Add `api_url` definition in `tf-modules/cumulus/archive.tf`
  - Add `archive_api_url` variable in `tf-modules/cumulus/variables.tf`

- **CUMULUS-1741**
  - Added an optional `elasticsearch_security_group_ids` variable to the
    `data-persistence` Terraform module to allow additional security groups to
    be assigned to the Elasticsearch Domain.

- **CUMULUS-1752**
  - Added `@cumulus/integration-tests/api/distribution.invokeTEADistributionLambda` to simulate a request to the [Thin Egress App](https://github.com/asfadmin/thin-egress-app) by invoking the Lambda and getting a response payload.
  - Added `@cumulus/integration-tests/api/distribution.getTEARequestHeaders` to generate necessary request headers for a request to the Thin Egress App
  - Added `@cumulus/integration-tests/api/distribution.getTEADistributionApiFileStream` to get a response stream for a file served by Thin Egress App
  - Added `@cumulus/integration-tests/api/distribution.getTEADistributionApiRedirect` to get a redirect response from the Thin Egress App

- **CUMULUS-1755**
  - Added `@cumulus/aws-client/CloudFormation.describeCfStack()` to describe a Cloudformation stack
  - Added `@cumulus/aws-client/CloudFormation.getCfStackParameterValues()` to get multiple parameter values for a Cloudformation stack

### Changed

- **CUMULUS-1725**
  - Moved the logic that updates the granule files cache Dynamo table into its
    own Lambda function called `granuleFilesCacheUpdater`.

- **CUMULUS-1736**
  - The `collections` model in the API package now determines the name of a
    collection based on the `name` property, rather than using `dataType` and
    then falling back to `name`.
  - The `@cumulus/integration-tests.loadCollection()` function no longer appends
    the postfix to the end of the collection's `dataType`.
  - The `@cumulus/integration-tests.addCollections()` function no longer appends
    the postfix to the end of the collection's `dataType`.

- **CUMULUS-1672**
  - Add a `retryOptions` parameter to the `@cumulus/aws-client/S3.headObject`
     function, which will retry if the object being queried does not exist.

- **CUMULUS-1446**
  - Mark the `@cumulus/integration-tests/api.addCollectionApi()` function as
    deprecated
  - Mark the `@cumulus/integration-tests/index.listCollections()` function as
    deprecated
  - Mark the `@cumulus/integration-tests/index.listProviders()` function as
    deprecated
  - Mark the `@cumulus/integration-tests/index.rulesList()` function as
    deprecated

- **CUMULUS-1672**
  - Previously, the `cumulus` module defaulted to setting a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, the `cumulus` module will now accept a `tags` input variable that
    defines the tags to be assigned to all resources that it manages.
  - Previously, the `data-persistence` module defaulted to setting a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, the `data-persistence` module will now accept a `tags` input
    variable that defines the tags to be assigned to all resources that it
    manages.
  - Previously, the `distribution` module defaulted to setting a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, the `distribution` module will now accept a `tags` input variable
    that defines the tags to be assigned to all resources that it manages.
  - Previously, the `ingest` module defaulted to setting a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, the `ingest` module will now accept a `tags` input variable that
    defines the tags to be assigned to all resources that it manages.
  - Previously, the `s3-replicator` module defaulted to setting a
    `Deployment = var.prefix` tag on all resources that it managed. In this
    release, the `s3-replicator` module will now accept a `tags` input variable
    that defines the tags to be assigned to all resources that it manages.

- **CUMULUS-1684**
  - Update the API package to encrypt provider credentials using KMS instead of
    using RSA keys stored in S3

- **CUMULUS-1717**
  - Changed name of `cwSfExecutionEventToDb` Lambda to `cwSfEventToDbRecords`
  - Updated `cwSfEventToDbRecords` to write granule records to DynamoDB from the incoming Cumulus message

- **CUMULUS-1718**
  - Renamed `cwSfEventToDbRecords` to `sfEventSqsToDbRecords` due to architecture change to being a consumer of an SQS queue of Step Function Cloudwatch events.
  - Updated `sfEventSqsToDbRecords` to write PDR records to DynamoDB from the incoming Cumulus message
  - Moved `data-cookbooks/sns.md` to `data-cookbooks/ingest-notifications.md` and updated it to reflect recent changes.

- **CUMULUS-1748**
  - (S)FTP discovery tasks now use the provider-path as-is instead of forcing it to a relative path.
  - Improved error handling to catch permission denied FTP errors better and log them properly. Workflows will still fail encountering this error and we intend to consider that approach in a future ticket.

- **CUMULUS-1752**
  - Moved class for parsing distribution events to its own file: `@cumulus/api/lib/DistributionEvent.js`
    - Updated `DistributionEvent` to properly parse S3 access logs generated by requests from the [Thin Egress App](https://github.com/asfadmin/thin-egress-app)

- **CUMULUS-1753** - Changes to `@cumulus/ingest/HttpProviderClient.js`:
  - Removed regex filter in `HttpProviderClient.list()` that was used to return only files with an extension between 1 and 4 characters long. `HttpProviderClient.list()` will now return all files linked from the HTTP provider host.

- **CUMULUS-1755**
  - Updated the Thin Egress App module used in `tf-modules/distribution/main.tf` to build 61. [See the release notes](https://github.com/asfadmin/thin-egress-app/releases/tag/tea-build.61).

- **CUMULUS-1757**
  - Update @cumulus/cmr-client CMRSearchConceptQueue to take optional cmrEnvironment parameter

### Deprecated

- **CUMULUS-1684**
  - Deprecate `@cumulus/common/key-pair-provider/S3KeyPairProvider`
  - Deprecate `@cumulus/common/key-pair-provider/S3KeyPairProvider.encrypt()`
  - Deprecate `@cumulus/common/key-pair-provider/S3KeyPairProvider.decrypt()`
  - Deprecate `@cumulus/common/kms/KMS`
  - Deprecate `@cumulus/common/kms/KMS.encrypt()`
  - Deprecate `@cumulus/common/kms/KMS.decrypt()`
  - Deprecate `@cumulus/common/sftp.Sftp`

- **CUMULUS-1717**
  - Deprecate `@cumulus/api/models/Granule.createGranulesFromSns`

- **CUMULUS-1718**
  - Deprecate `@cumulus/sf-sns-report`.
    - This task has been updated to always throw an error directing the user to use `@cumulus/sf-sqs-report` instead. This was done because there is no longer an SNS topic to which to publish, and no consumers to listen to it.

- **CUMULUS-1748**
  - Deprecate `@cumulus/ingest/util.normalizeProviderPath`

- **CUMULUS-1752**
  - Deprecate `@cumulus/integration-tests/api/distribution.getDistributionApiFileStream`
  - Deprecate `@cumulus/integration-tests/api/distribution.getDistributionApiRedirect`
  - Deprecate `@cumulus/integration-tests/api/distribution.invokeApiDistributionLambda`

### Removed

- **CUMULUS-1684**
  - Remove the deployment script that creates encryption keys and stores them to
    S3

- **CUMULUS-1768**
  - Removed API endpoints `stats/histogram` and `stats/average`. All advanced stats needs should be acquired from Cloud Metrics or similarly configured ELK stack.

### Fixed

- **Fix default values for urs_url in variables.tf files**
  - Remove trailing `/` from default `urs_url` values.

- **CUMULUS-1610** - Add the Elasticsearch security group to the EC2 security groups

- **CUMULUS-1740** - `cumulus_meta.workflow_start_time` is now set in Cumulus
  messages

- **CUMULUS-1753** - Fixed `@cumulus/ingest/HttpProviderClient.js` to properly handle HTTP providers with:
  - Multiple link tags (e.g. `<a>`) per line of source code
  - Link tags in uppercase or lowercase (e.g. `<A>`)
  - Links with filepaths in the link target (e.g. `<a href="/path/to/file.txt">`). These files will be returned from HTTP file discovery **as the file name only** (e.g. `file.txt`).

- **CUMULUS-1768**
  - Fix an issue in the stats endpoints in `@cumulus/api` to send back stats for the correct type

## [v1.18.0] 2020-02-03

### BREAKING CHANGES

- **CUMULUS-1686**

  - `ecs_cluster_instance_image_id` is now a _required_ variable of the `cumulus` module, instead of optional.

- **CUMULUS-1698**

  - Change variable `saml_launchpad_metadata_path` to `saml_launchpad_metadata_url` in the `tf-modules/cumulus` Terraform module.

- **CUMULUS-1703**
  - Remove the unused `forceDownload` option from the `sync-granule` tasks's config
  - Remove the `@cumulus/ingest/granule.Discover` class
  - Remove the `@cumulus/ingest/granule.Granule` class
  - Remove the `@cumulus/ingest/pdr.Discover` class
  - Remove the `@cumulus/ingest/pdr.Granule` class
  - Remove the `@cumulus/ingest/parse-pdr.parsePdr` function

### Added

- **CUMULUS-1040**

  - Added `@cumulus/aws-client` package to provide utilities for working with AWS services and the Node.js AWS SDK
  - Added `@cumulus/errors` package which exports error classes for use in Cumulus workflow code
  - Added `@cumulus/integration-tests/sfnStep` to provide utilities for parsing step function execution histories

- **CUMULUS-1102**

  - Adds functionality to the @cumulus/api package for better local testing.
    - Adds data seeding for @cumulus/api's localAPI.
      - seed functions allow adding collections, executions, granules, pdrs, providers, and rules to a Localstack Elasticsearch and DynamoDB via `addCollections`, `addExecutions`, `addGranules`, `addPdrs`, `addProviders`, and `addRules`.
    - Adds `eraseDataStack` function to local API server code allowing resetting of local datastack for testing (ES and DynamoDB).
    - Adds optional parameters to the @cumulus/api bin serve to allow for launching the api without destroying the current data.

- **CUMULUS-1697**

  - Added the `@cumulus/tf-inventory` package that provides command line utilities for managing Terraform resources in your AWS account

- **CUMULUS-1703**

  - Add `@cumulus/aws-client/S3.createBucket` function
  - Add `@cumulus/aws-client/S3.putFile` function
  - Add `@cumulus/common/string.isNonEmptyString` function
  - Add `@cumulus/ingest/FtpProviderClient` class
  - Add `@cumulus/ingest/HttpProviderClient` class
  - Add `@cumulus/ingest/S3ProviderClient` class
  - Add `@cumulus/ingest/SftpProviderClient` class
  - Add `@cumulus/ingest/providerClientUtils.buildProviderClient` function
  - Add `@cumulus/ingest/providerClientUtils.fetchTextFile` function

- **CUMULUS-1731**

  - Add new optional input variables to the Cumulus Terraform module to support TEA upgrade:
    - `thin_egress_cookie_domain` - Valid domain for Thin Egress App cookie
    - `thin_egress_domain_cert_arn` - Certificate Manager SSL Cert ARN for Thin
      Egress App if deployed outside NGAP/CloudFront
    - `thin_egress_download_role_in_region_arn` - ARN for reading of Thin Egress
      App data buckets for in-region requests
    - `thin_egress_jwt_algo` - Algorithm with which to encode the Thin Egress
      App JWT cookie
    - `thin_egress_jwt_secret_name` - Name of AWS secret where keys for the Thin
      Egress App JWT encode/decode are stored
    - `thin_egress_lambda_code_dependency_archive_key` - Thin Egress App - S3
      Key of packaged python modules for lambda dependency layer

- **CUMULUS-1733**
  - Add `discovery-filtering` operator doc to document previously undocumented functionality.

- **CUMULUS-1737**
  - Added the `cumulus-test-cleanup` module to run a nightly cleanup on resources left over from the integration tests run from the `example/spec` directory.

### Changed

- **CUMULUS-1102**

  - Updates `@cumulus/api/auth/testAuth` to use JWT instead of random tokens.
  - Updates the default AMI for the ecs_cluster_instance_image_id.

- **CUMULUS-1622**

  - Mutex class has been deprecated in `@cumulus/common/concurrency` and will be removed in a future release.

- **CUMULUS-1686**

  - Changed `ecs_cluster_instance_image_id` to be a required variable of the `cumulus` module and removed the default value.
    The default was not available across accounts and regions, nor outside of NGAP and therefore not particularly useful.

- **CUMULUS-1688**

  - Updated `@cumulus/aws.receiveSQSMessages` not to replace `message.Body` with a parsed object. This behavior was undocumented and confusing as received messages appeared to contradict AWS docs that state `message.Body` is always a string.
  - Replaced `sf_watcher` CloudWatch rule from `cloudwatch-events.tf` with an EventSourceMapping on `sqs2sf` mapped to the `start_sf` SQS queue (in `event-sources.tf`).
  - Updated `sqs2sf` with an EventSourceMapping handler and unit test.

- **CUMULUS-1698**

  - Change variable `saml_launchpad_metadata_path` to `saml_launchpad_metadata_url` in the `tf-modules/cumulus` Terraform module.
  - Updated `@cumulus/api/launchpadSaml` to download launchpad IDP metadata from configured location when the metadata in s3 is not valid, and to work with updated IDP metadata and SAML response.

- **CUMULUS-1731**
  - Upgrade the version of the Thin Egress App deployed by Cumulus to v48
    - Note: New variables available, see the 'Added' section of this changelog.

### Fixed

- **CUMULUS-1664**

  - Updated `dbIndexer` Lambda to remove hardcoded references to DynamoDB table names.

- **CUMULUS-1733**
  - Fixed granule discovery recursion algorithm used in S/FTP protocols.

### Removed

- **CUMULUS-1481**
  - removed `process` config and output from PostToCmr as it was not required by the task nor downstream steps, and should still be in the output message's `meta` regardless.

### Deprecated

- **CUMULUS-1040**
  - Deprecated the following code. For cases where the code was moved into another package, the new code location is noted:
    - `@cumulus/common/CloudFormationGateway` -> `@cumulus/aws-client/CloudFormationGateway`
    - `@cumulus/common/DynamoDb` -> `@cumulus/aws-client/DynamoDb`
    - `@cumulus/common/errors` -> `@cumulus/errors`
    - `@cumulus/common/StepFunctions` -> `@cumulus/aws-client/StepFunctions`
    - All of the exported functions in `@cumulus/commmon/aws` (moved into `@cumulus/aws-client`), except:
      - `@cumulus/common/aws/isThrottlingException` -> `@cumulus/errors/isThrottlingException`
      - `@cumulus/common/aws/improveStackTrace` (not deprecated)
      - `@cumulus/common/aws/retryOnThrottlingException` (not deprecated)
    - `@cumulus/common/sfnStep/SfnStep.parseStepMessage` -> `@cumulus/integration-tests/sfnStep/SfnStep.parseStepMessage`
    - `@cumulus/common/sfnStep/ActivityStep` -> `@cumulus/integration-tests/sfnStep/ActivityStep`
    - `@cumulus/common/sfnStep/LambdaStep` -> `@cumulus/integration-tests/sfnStep/LambdaStep`
    - `@cumulus/common/string/unicodeEscape` -> `@cumulus/aws-client/StepFunctions.unicodeEscape`
    - `@cumulus/common/util/setErrorStack` -> `@cumulus/aws-client/util/setErrorStack`
    - `@cumulus/ingest/aws/invoke` -> `@cumulus/aws-client/Lambda/invoke`
    - `@cumulus/ingest/aws/CloudWatch.bucketSize`
    - `@cumulus/ingest/aws/CloudWatch.cw`
    - `@cumulus/ingest/aws/ECS.ecs`
    - `@cumulus/ingest/aws/ECS`
    - `@cumulus/ingest/aws/Events.putEvent` -> `@cumulus/aws-client/CloudwatchEvents.putEvent`
    - `@cumulus/ingest/aws/Events.deleteEvent` -> `@cumulus/aws-client/CloudwatchEvents.deleteEvent`
    - `@cumulus/ingest/aws/Events.deleteTarget` -> `@cumulus/aws-client/CloudwatchEvents.deleteTarget`
    - `@cumulus/ingest/aws/Events.putTarget` -> `@cumulus/aws-client/CloudwatchEvents.putTarget`
    - `@cumulus/ingest/aws/SQS.attributes` -> `@cumulus/aws-client/SQS.getQueueAttributes`
    - `@cumulus/ingest/aws/SQS.deleteMessage` -> `@cumulus/aws-client/SQS.deleteSQSMessage`
    - `@cumulus/ingest/aws/SQS.deleteQueue` -> `@cumulus/aws-client/SQS.deleteQueue`
    - `@cumulus/ingest/aws/SQS.getUrl` -> `@cumulus/aws-client/SQS.getQueueUrlByName`
    - `@cumulus/ingest/aws/SQS.receiveMessage` -> `@cumulus/aws-client/SQS.receiveSQSMessages`
    - `@cumulus/ingest/aws/SQS.sendMessage` -> `@cumulus/aws-client/SQS.sendSQSMessage`
    - `@cumulus/ingest/aws/StepFunction.getExecutionStatus` -> `@cumulus/aws-client/StepFunction.getExecutionStatus`
    - `@cumulus/ingest/aws/StepFunction.getExecutionUrl` -> `@cumulus/aws-client/StepFunction.getExecutionUrl`

## [v1.17.0] - 2019-12-31

### BREAKING CHANGES

- **CUMULUS-1498**
  - The `@cumulus/cmrjs.publish2CMR` function expects that the value of its
    `creds.password` parameter is a plaintext password.
  - Rather than using an encrypted password from the `cmr_password` environment
    variable, the `@cumulus/cmrjs.updateCMRMetadata` function now looks for an
    environment variable called `cmr_password_secret_name` and fetches the CMR
    password from that secret in AWS Secrets Manager.
  - The `@cumulus/post-to-cmr` task now expects a
    `config.cmr.passwordSecretName` value, rather than `config.cmr.password`.
    The CMR password will be fetched from that secret in AWS Secrets Manager.

### Added

- **CUMULUS-630**

  - Added support for replaying Kinesis records on a stream into the Cumulus Kinesis workflow triggering mechanism: either all the records, or some time slice delimited by start and end timestamps.
  - Added `/replays` endpoint to the operator API for triggering replays.
  - Added `Replay Kinesis Messages` documentation to Operator Docs.
  - Added `manualConsumer` lambda function to consume a Kinesis stream. Used by the replay AsyncOperation.

- **CUMULUS-1687**
  - Added new API endpoint for listing async operations at `/asyncOperations`
  - All asyncOperations now include the fields `description` and `operationType`. `operationType` can be one of the following. [`Bulk Delete`, `Bulk Granules`, `ES Index`, `Kinesis Replay`]

### Changed

- **CUMULUS-1626**

  - Updates Cumulus to use node10/CMA 1.1.2 for all of its internal lambdas in prep for AWS node 8 EOL

- **CUMULUS-1498**
  - Remove the DynamoDB Users table. The list of OAuth users who are allowed to
    use the API is now stored in S3.
  - The CMR password and Launchpad passphrase are now stored in Secrets Manager

## [v1.16.1] - 2019-12-6

**Please note**:

- The `region` argument to the `cumulus` Terraform module has been removed. You may see a warning or error if you have that variable populated.
- Your workflow tasks should use the following versions of the CMA libraries to utilize new granule, parentArn, asyncOperationId, and stackName fields on the logs:
  - `cumulus-message-adapter-js` version 1.0.10+
  - `cumulus-message-adapter-python` version 1.1.1+
  - `cumulus-message-adapter-java` version 1.2.11+
- The `data-persistence` module no longer manages the creation of an Elasticsearch service-linked role for deploying Elasticsearch to a VPC. Follow the [deployment instructions on preparing your VPC](https://nasa.github.io/cumulus/docs/deployment/deployment-readme#vpc-subnets-and-security-group) for guidance on how to create the Elasticsearch service-linked role manually.
- There is now a `distribution_api_gateway_stage` variable for the `tf-modules/cumulus` Terraform module that will be used as the API gateway stage name used for the distribution API (Thin Egress App)
- Default value for the `urs_url` variable is now `https://uat.urs.earthdata.nasa.gov/` in the `tf-modules/cumulus` and `tf-modules/archive` Terraform modules. So deploying the `cumulus` module without a `urs_url` variable set will integrate your Cumulus deployment with the UAT URS environment.

### Added

- **CUMULUS-1563**

  - Added `custom_domain_name` variable to `tf-modules/data-persistence` module

- **CUMULUS-1654**
  - Added new helpers to `@cumulus/common/execution-history`:
    - `getStepExitedEvent()` returns the `TaskStateExited` event in a workflow execution history after the given step completion/failure event
    - `getTaskExitedEventOutput()` returns the output message for a `TaskStateExited` event in a workflow execution history

### Changed

- **CUMULUS-1578**

  - Updates SAML launchpad configuration to authorize via configured userGroup.
    [See the NASA specific documentation (protected)](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+SAML+Launchpad+Integration)

- **CUMULUS-1579**

  - Elasticsearch list queries use `match` instead of `term`. `term` had been analyzing the terms and not supporting `-` in the field values.

- **CUMULUS-1619**

  - Adds 4 new keys to `@cumulus/logger` to display granules, parentArn, asyncOperationId, and stackName.
  - Depends on `cumulus-message-adapter-js` version 1.0.10+. Cumulus tasks updated to use this version.

- **CUMULUS-1654**

  - Changed `@cumulus/common/SfnStep.parseStepMessage()` to a static class method

- **CUMULUS-1641**
  - Added `meta.retries` and `meta.visibilityTimeout` properties to sqs-type rule. To create sqs-type rule, you're required to configure a dead-letter queue on your queue.
  - Added `sqsMessageRemover` lambda which removes the message from SQS queue upon successful workflow execution.
  - Updated `sqsMessageConsumer` lambda to not delete message from SQS queue, and to retry the SQS message for configured number of times.

### Removed

- Removed `create_service_linked_role` variable from `tf-modules/data-persistence` module.

- **CUMULUS-1321**
  - The `region` argument to the `cumulus` Terraform module has been removed

### Fixed

- **CUMULUS-1668** - Fixed a race condition where executions may not have been
  added to the database correctly
- **CUMULUS-1654** - Fixed issue with `publishReports` Lambda not including workflow execution error information for failed workflows with a single step
- Fixed `tf-modules/cumulus` module so that the `urs_url` variable is passed on to its invocation of the `tf-modules/archive` module

## [v1.16.0] - 2019-11-15

### Added

- **CUMULUS-1321**

  - A `deploy_distribution_s3_credentials_endpoint` variable has been added to
    the `cumulus` Terraform module. If true, the NGAP-backed S3 credentials
    endpoint will be added to the Thin Egress App's API. Default: true

- **CUMULUS-1544**

  - Updated the `/granules/bulk` endpoint to correctly query Elasticsearch when
    granule ids are not provided.

- **CUMULUS-1580**
  - Added `/granules/bulk` endpoint to `@cumulus/api` to perform bulk actions on granules given either a list of granule ids or an Elasticsearch query and the workflow to perform.

### Changed

- **CUMULUS-1561**

  - Fix the way that we are handling Terraform provider version requirements
  - Pass provider configs into child modules using the method that the
    [Terraform documentation](https://www.terraform.io/docs/configuration/modules.html#providers-within-modules)
    suggests
  - Remove the `region` input variable from the `s3_access_test` Terraform module
  - Remove the `aws_profile` and `aws_region` input variables from the
    `s3-replicator` Terraform module

- **CUMULUS-1639**
  - Because of
    [S3's Data Consistency Model](https://docs.aws.amazon.com/AmazonS3/latest/dev/Introduction.html#BasicsObjects),
    there may be situations where a GET operation for an object can temporarily
    return a `NoSuchKey` response even if that object _has_ been created. The
    `@cumulus/common/aws.getS3Object()` function has been updated to support
    retries if a `NoSuchKey` response is returned by S3. This behavior can be
    enabled by passing a `retryOptions` object to that function. Supported
    values for that object can be found here:
    <https://github.com/tim-kos/node-retry#retryoperationoptions>

### Removed

- **CUMULUS-1559**
  - `logToSharedDestination` has been migrated to the Terraform deployment as `log_api_gateway_to_cloudwatch` and will ONLY apply to egress lambdas.
    Due to the differences in the Terraform deployment model, we cannot support a global log subscription toggle for a configurable subset of lambdas.
    However, setting up your own log forwarding for a Lambda with Terraform is fairly simple, as you will only need to add SubscriptionFilters to your Terraform configuration, one per log group.
    See [the Terraform documentation](https://www.terraform.io/docs/providers/aws/r/cloudwatch_log_subscription_filter.html) for details on how to do this.
    An empty FilterPattern ("") will capture all logs in a group.

## [v1.15.0] - 2019-11-04

### BREAKING CHANGES

- **CUMULUS-1644** - When a workflow execution begins or ends, the workflow
  payload is parsed and any new or updated PDRs or granules referenced in that
  workflow are stored to the Cumulus archive. The defined interface says that a
  PDR in `payload.pdr` will be added to the archive, and any granules in
  `payload.granules` will also be added to the archive. In previous releases,
  PDRs found in `meta.pdr` and granules found in `meta.input_granules` were also
  added to the archive. This caused unexpected behavior and has been removed.
  Only PDRs from `payload.pdr` and granules from `payload.granules` will now be
  added to the Cumulus archive.

- **CUMULUS-1449** - Cumulus now uses a universal workflow template when
  starting a workflow that contains general information specific to the
  deployment, but not specific to the workflow. Workflow task configs must be
  defined using AWS step function parameters. As part of this change,
  `CumulusConfig` has been retired and task configs must now be defined under
  the `cma.task_config` key in the Parameters section of a step function
  definition.

  **Migration instructions**:

  NOTE: These instructions require the use of Cumulus Message Adapter v1.1.x+.
  Please ensure you are using a compatible version before attempting to migrate
  workflow configurations. When defining workflow steps, remove any
  `CumulusConfig` section, as shown below:

  ```yaml
  ParsePdr:
    CumulusConfig:
      provider: "{$.meta.provider}"
      bucket: "{$.meta.buckets.internal.name}"
      stack: "{$.meta.stack}"
  ```

  Instead, use AWS Parameters to pass `task_config` for the task directly into
  the Cumulus Message Adapter:

  ```yaml
  ParsePdr:
    Parameters:
      cma:
        event.$: "$"
        task_config:
          provider: "{$.meta.provider}"
          bucket: "{$.meta.buckets.internal.name}"
          stack: "{$.meta.stack}"
  ```

  In this example, the `cma` key is used to pass parameters to the message
  adapter. Using `task_config` in combination with `event.$: '$'` allows the
  message adapter to process `task_config` as the `config` passed to the Cumulus
  task. See `example/workflows/sips.yml` in the core repository for further
  examples of how to set the Parameters.

  Additionally, workflow configurations for the `QueueGranules` and `QueuePdrs`
  tasks need to be updated:

  - `queue-pdrs` config changes:
    - `parsePdrMessageTemplateUri` replaced with `parsePdrWorkflow`, which is
      the workflow name (i.e. top-level name in `config.yml`, e.g. 'ParsePdr').
    - `internalBucket` and `stackName` configs now required to look up
      configuration from the deployment. Brings the task config in line with
      that of `queue-granules`.
  - `queue-granules` config change: `ingestGranuleMessageTemplateUri` replaced
    with `ingestGranuleWorkflow`, which is the workflow name (e.g.
    'IngestGranule').

- **CUMULUS-1396** - **Workflow steps at the beginning and end of a workflow
  using the `SfSnsReport` Lambda have now been deprecated (e.g. `StartStatus`,
  `StopStatus`) and should be removed from your workflow definitions**. These
  steps were used for publishing ingest notifications and have been replaced by
  an implementation using Cloudwatch events for Step Functions to trigger a
  Lambda that publishes ingest notifications. For further detail on how ingest
  notifications are published, see the notes below on **CUMULUS-1394**. For
  examples of how to update your workflow definitions, see our
  [example workflow definitions](https://github.com/nasa/cumulus/blob/master/example/workflows/).

- **CUMULUS-1470**
  - Remove Cumulus-defined ECS service autoscaling, allowing integrators to
    better customize autoscaling to meet their needs. In order to use
    autoscaling with ECS services, appropriate
    `AWS::ApplicationAutoScaling::ScalableTarget`,
    `AWS::ApplicationAutoScaling::ScalingPolicy`, and `AWS::CloudWatch::Alarm`
    resources should be defined in a kes overrides file. See
    [this example](https://github.com/nasa/cumulus/blob/release-1.15.x/example/overrides/app/cloudformation.template.yml)
    for an example.
  - The following config parameters are no longer used:
    - ecs.services.\<NAME\>.minTasks
    - ecs.services.\<NAME\>.maxTasks
    - ecs.services.\<NAME\>.scaleInActivityScheduleTime
    - ecs.services.\<NAME\>.scaleInAdjustmentPercent
    - ecs.services.\<NAME\>.scaleOutActivityScheduleTime
    - ecs.services.\<NAME\>.scaleOutAdjustmentPercent
    - ecs.services.\<NAME\>.activityName

### Added

- **CUMULUS-1100**

  - Added 30-day retention properties to all log groups that were missing those policies.

- **CUMULUS-1396**

  - Added `@cumulus/common/sfnStep`:
    - `LambdaStep` - A class for retrieving and parsing input and output to Lambda steps in AWS Step Functions
    - `ActivityStep` - A class for retrieving and parsing input and output to ECS activity steps in AWS Step Functions

- **CUMULUS-1574**

  - Added `GET /token` endpoint for SAML authorization when cumulus is protected by Launchpad.
    This lets a user retrieve a token by hand that can be presented to the API.

- **CUMULUS-1625**

  - Added `sf_start_rate` variable to the `ingest` Terraform module, equivalent to `sqs_consumer_rate` in the old model, but will not be automatically applied to custom queues as that was.

- **CUMULUS-1513**
  - Added `sqs`-type rule support in the Cumulus API `@cumulus/api`
  - Added `sqsMessageConsumer` lambda which processes messages from the SQS queues configured in the `sqs` rules.

### Changed

- **CUMULUS-1639**

  - Because of
    [S3's Data Consistency Model](https://docs.aws.amazon.com/AmazonS3/latest/dev/Introduction.html#BasicsObjects),
    there may be situations where a GET operation for an object can temporarily
    return a `NoSuchKey` response even if that object _has_ been created. The
    `@cumulus/common/aws.getS3Object()` function will now retry up to 10 times
    if a `NoSuchKey` response is returned by S3. This can behavior can be
    overridden by passing `{ retries: 0 }` as the `retryOptions` argument.

- **CUMULUS-1449**

  - `queue-pdrs` & `queue-granules` config changes. Details in breaking changes section.
  - Cumulus now uses a universal workflow template when starting workflow that contains general information specific to the deployment, but not specific to the workflow.
  - Changed the way workflow configs are defined, from `CumulusConfig` to a `task_config` AWS Parameter.

- **CUMULUS-1452**

  - Changed the default ECS docker storage drive to `devicemapper`

- **CUMULUS-1453**
  - Removed config schema for `@cumulus/sf-sns-report` task
  - Updated `@cumulus/sf-sns-report` to always assume that it is running as an intermediate step in a workflow, not as the first or last step

### Removed

- **CUMULUS-1449**
  - Retired `CumulusConfig` as part of step function definitions, as this is an artifact of the way Kes parses workflow definitions that was not possible to migrate to Terraform. Use AWS Parameters and the `task_config` key instead. See change note above.
  - Removed individual workflow templates.

### Fixed

- **CUMULUS-1620** - Fixed bug where `message_adapter_version` does not correctly inject the CMA

- **CUMULUS-1396** - Updated `@cumulus/common/StepFunctions.getExecutionHistory()` to recursively fetch execution history when `nextToken` is returned in response

- **CUMULUS-1571** - Updated `@cumulus/common/DynamoDb.get()` to throw any errors encountered when trying to get a record and the record does exist

- **CUMULUS-1452**
  - Updated the EC2 initialization scripts to use full volume size for docker storage
  - Changed the default ECS docker storage drive to `devicemapper`

## [v1.14.5] - 2019-12-30 - [BACKPORT]

### Updated

- **CUMULUS-1626**
  - Updates Cumulus to use node10/CMA 1.1.2 for all of its internal lambdas in prep for AWS node 8 EOL

## [v1.14.4] - 2019-10-28

### Fixed

- **CUMULUS-1632** - Pinned `aws-elasticsearch-connector` package in `@cumulus/api` to version `8.1.3`, since `8.2.0` includes breaking changes

## [v1.14.3] - 2019-10-18

### Fixed

- **CUMULUS-1620** - Fixed bug where `message_adapter_version` does not correctly inject the CMA

- **CUMULUS-1572** - A granule is now included in discovery results even when
  none of its files has a matching file type in the associated collection
  configuration. Previously, if all files for a granule were unmatched by a file
  type configuration, the granule was excluded from the discovery results.
  Further, added support for a `boolean` property
  `ignoreFilesConfigForDiscovery`, which controls how a granule's files are
  filtered at discovery time.

## [v1.14.2] - 2019-10-08

### BREAKING CHANGES

Your Cumulus Message Adapter version should be pinned to `v1.0.13` or lower in your `app/config.yml` using `message_adapter_version: v1.0.13` OR you should use the workflow migration steps below to work with CMA v1.1.1+.

- **CUMULUS-1394** - The implementation of the `SfSnsReport` Lambda requires additional environment variables for integration with the new ingest notification SNS topics. Therefore, **you must update the definition of `SfSnsReport` in your `lambdas.yml` like so**:

```yaml
SfSnsReport:
  handler: index.handler
  timeout: 300
  source: node_modules/@cumulus/sf-sns-report/dist
  tables:
    - ExecutionsTable
  envs:
    execution_sns_topic_arn:
      function: Ref
      value: reportExecutionsSns
    granule_sns_topic_arn:
      function: Ref
      value: reportGranulesSns
    pdr_sns_topic_arn:
      function: Ref
      value: reportPdrsSns
```

- **CUMULUS-1447** -
  The newest release of the Cumulus Message Adapter (v1.1.1) requires that parameterized configuration be used for remote message functionality. Once released, Kes will automatically bring in CMA v1.1.1 without additional configuration.

  **Migration instructions**
  Oversized messages are no longer written to S3 automatically. In order to utilize remote messaging functionality, configure a `ReplaceConfig` AWS Step Function parameter on your CMA task:

  ```yaml
  ParsePdr:
    Parameters:
      cma:
        event.$: "$"
        ReplaceConfig:
          FullMessage: true
  ```

  Accepted fields in `ReplaceConfig` include `MaxSize`, `FullMessage`, `Path` and `TargetPath`.
  See https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md#remote-message-configuration for full details.

  As this change is backward compatible in Cumulus Core, users wishing to utilize the previous version of the CMA may opt to transition to using a CMA lambda layer, or set `message_adapter_version` in their configuration to a version prior to v1.1.0.

### PLEASE NOTE

- **CUMULUS-1394** - Ingest notifications are now provided via 3 separate SNS topics for executions, granules, and PDRs, instead of a single `sftracker` SNS topic. Whereas the `sftracker` SNS topic received a full Cumulus execution message, the new topics all receive generated records for the given object. The new topics are only published to if the given object exists for the current execution. For a given execution/granule/PDR, **two messages will be received by each topic**: one message indicating that ingest is running and another message indicating that ingest has completed or failed. The new SNS topics are:

  - `reportExecutions` - Receives 1 message per execution
  - `reportGranules` - Receives 1 message per granule in an execution
  - `reportPdrs` - Receives 1 message per PDR

### Added

- **CUMULUS-639**

  - Adds SAML JWT and launchpad token authentication to Cumulus API (configurable)
    - **NOTE** to authenticate with Launchpad ensure your launchpad user_id is in the `<prefix>-UsersTable`
    - when Cumulus configured to protect API via Launchpad:
      - New endpoints
        - `GET /saml/login` - starting point for SAML SSO creates the login request url and redirects to the SAML Identity Provider Service (IDP)
        - `POST /saml/auth` - SAML Assertion Consumer Service. POST receiver from SAML IDP. Validates response, logs the user in, and returns a SAML-based JWT.
    - Disabled endpoints
      - `POST /refresh`
      - Changes authorization worklow:
      - `ensureAuthorized` now presumes the bearer token is a JWT and tries to validate. If the token is malformed, it attempts to validate the token against Launchpad. This allows users to bring their own token as described here https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+API+with+Launchpad+Authentication. But it also allows dashboard users to manually authenticate via Launchpad SAML to receive a Launchpad-based JWT.

- **CUMULUS-1394**
  - Added `Granule.generateGranuleRecord()` method to granules model to generate a granule database record from a Cumulus execution message
  - Added `Pdr.generatePdrRecord()` method to PDRs model to generate a granule database record from a Cumulus execution message
  - Added helpers to `@cumulus/common/message`:
    - `getMessageExecutionName()` - Get the execution name from a Cumulus execution message
    - `getMessageStateMachineArn()` - Get the state machine ARN from a Cumulus execution message
    - `getMessageExecutionArn()` - Get the execution ARN for a Cumulus execution message
    - `getMessageGranules()` - Get the granules from a Cumulus execution message, if any.
  - Added `@cumulus/common/cloudwatch-event/isFailedSfStatus()` to determine if a Step Function status from a Cloudwatch event is a failed status

### Changed

- **CUMULUS-1308**

  - HTTP PUT of a Collection, Provider, or Rule via the Cumulus API now
    performs full replacement of the existing object with the object supplied
    in the request payload. Previous behavior was to perform a modification
    (partial update) by merging the existing object with the (possibly partial)
    object in the payload, but this did not conform to the HTTP standard, which
    specifies PATCH as the means for modifications rather than replacements.

- **CUMULUS-1375**

  - Migrate Cumulus from deprecated Elasticsearch JS client to new, supported one in `@cumulus/api`

- **CUMULUS-1485** Update `@cumulus/cmr-client` to return error message from CMR for validation failures.

- **CUMULUS-1394**

  - Renamed `Execution.generateDocFromPayload()` to `Execution.generateRecord()` on executions model. The method generates an execution database record from a Cumulus execution message.

- **CUMULUS-1432**

  - `logs` endpoint takes the level parameter as a string and not a number
  - Elasticsearch term query generation no longer converts numbers to boolean

- **CUMULUS-1447**

  - Consolidated all remote message handling code into @common/aws
  - Update remote message code to handle updated CMA remote message flags
  - Update example SIPS workflows to utilize Parameterized CMA configuration

- **CUMULUS-1448** Refactor workflows that are mutating cumulus_meta to utilize meta field

- **CUMULUS-1451**

  - Elasticsearch cluster setting `auto_create_index` will be set to false. This had been causing issues in the bootstrap lambda on deploy.

- **CUMULUS-1456**
  - `@cumulus/api` endpoints default error handler uses `boom` package to format errors, which is consistent with other API endpoint errors.

### Fixed

- **CUMULUS-1432** `logs` endpoint filter correctly filters logs by level
- **CUMULUS-1484** `useMessageAdapter` now does not set CUMULUS_MESSAGE_ADAPTER_DIR when `true`

### Removed

- **CUMULUS-1394**
  - Removed `sfTracker` SNS topic. Replaced by three new SNS topics for granule, execution, and PDR ingest notifications.
  - Removed unused functions from `@cumulus/common/aws`:
    - `getGranuleS3Params()`
    - `setGranuleStatus()`

## [v1.14.1] - 2019-08-29

### Fixed

- **CUMULUS-1455**

  - CMR token links updated to point to CMR legacy services rather than echo

- **CUMULUS-1211**
  - Errors thrown during granule discovery are no longer swallowed and ignored.
    Rather, errors are propagated to allow for proper error-handling and
    meaningful messaging.

## [v1.14.0] - 2019-08-22

### PLEASE NOTE

- We have encountered transient lambda service errors in our integration testing. Please handle transient service errors following [these guidelines](https://docs.aws.amazon.com/step-functions/latest/dg/bp-lambda-serviceexception.html). The workflows in the `example/workflows` folder have been updated with retries configured for these errors.

- **CUMULUS-799** added additional IAM permissions to support reading CloudWatch and API Gateway, so **you will have to redeploy your IAM stack.**

- **CUMULUS-800** Several items:

  - **Delete existing API Gateway stages**: To allow enabling of API Gateway logging, Cumulus now creates and manages a Stage resource during deployment. Before upgrading Cumulus, it is necessary to delete the API Gateway stages on both the Backend API and the Distribution API. Instructions are included in the documentation under [Delete API Gateway Stages](https://nasa.github.io/cumulus/docs/additional-deployment-options/delete-api-gateway-stages).

  - **Set up account permissions for API Gateway to write to CloudWatch**: In a one time operation for your AWS account, to enable CloudWatch Logs for API Gateway, you must first grant the API Gateway permission to read and write logs to CloudWatch for your account. The `AmazonAPIGatewayPushToCloudWatchLogs` managed policy (with an ARN of `arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs`) has all the required permissions. You can find a simple how to in the documentation under [Enable API Gateway Logging.](https://nasa.github.io/cumulus/docs/additional-deployment-options/enable-gateway-logging-permissions)

  - **Configure API Gateway to write logs to CloudWatch** To enable execution logging for the distribution API set `config.yaml` `apiConfigs.distribution.logApigatewayToCloudwatch` value to `true`. More information [Enable API Gateway Logs](https://nasa.github.io/cumulus/docs/additional-deployment-options/enable-api-logs)

  - **Configure CloudWatch log delivery**: It is possible to deliver CloudWatch API execution and access logs to a cross-account shared AWS::Logs::Destination. An operator does this by adding the key `logToSharedDestination` to the `config.yml` at the default level with a value of a writable log destination. More information in the documentation under [Configure CloudWatch Logs Delivery.](https://nasa.github.io/cumulus/docs/additional-deployment-options/configure-cloudwatch-logs-delivery)

  - **Additional Lambda Logging**: It is now possible to configure any lambda to deliver logs to a shared subscriptions by setting `logToSharedDestination` to the ARN of a writable location (either an AWS::Logs::Destination or a Kinesis Stream) on any lambda config. Documentation for [Lambda Log Subscriptions](https://nasa.github.io/cumulus/docs/additional-deployment-options/additional-lambda-logging)

  - **Configure S3 Server Access Logs**: If you are running Cumulus in an NGAP environment you may [configure S3 Server Access Logs](https://nasa.github.io/cumulus/docs/next/deployment/server_access_logging) to be delivered to a shared bucket where the Metrics Team will ingest the logs into their ELK stack. Contact the Metrics team for permission and location.

- **CUMULUS-1368** The Cumulus distribution API has been deprecated and is being replaced by ASF's Thin Egress App. By default, the distribution API will not deploy. Please follow [the instructions for deploying and configuring Thin Egress](https://nasa.github.io/cumulus/docs/deployment/thin_egress_app).

To instead continue to deploy and use the legacy Cumulus distribution app, add the following to your `config.yml`:

```yaml
deployDistributionApi: true
```

If you deploy with no distribution app your deployment will succeed but you may encounter errors in your workflows, particularly in the `MoveGranule` task.

- **CUMULUS-1418** Users who are packaging the CMA in their Lambdas outside of Cumulus may need to update their Lambda configuration. Please see `BREAKING CHANGES` below for details.

### Added

- **CUMULUS-642**
  - Adds Launchpad as an authentication option for the Cumulus API.
  - Updated deployment documentation and added [instructions to setup Cumulus API Launchpad authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+API+with+Launchpad+Authentication)
- **CUMULUS-1418**
  - Adds usage docs/testing of lambda layers (introduced in PR1125), updates Core example tasks to use the updated `cumulus-ecs-task` and a CMA layer instead of kes CMA injection.
  - Added Terraform module to publish CMA as layer to user account.
- **PR1125** - Adds `layers` config option to support deploying Lambdas with layers
- **PR1128** - Added `useXRay` config option to enable AWS X-Ray for Lambdas.
- **CUMULUS-1345**
  - Adds new variables to the app deployment under `cmr`.
  - `cmrEnvironment` values are `SIT`, `UAT`, or `OPS` with `UAT` as the default.
  - `cmrLimit` and `cmrPageSize` have been added as configurable options.
- **CUMULUS-1273**
  - Added lambda function EmsProductMetadataReport to generate EMS Product Metadata report
- **CUMULUS-1226**
  - Added API endpoint `elasticsearch/index-from-database` to index to an Elasticsearch index from the database for recovery purposes and `elasticsearch/indices-status` to check the status of Elasticsearch indices via the API.
- **CUMULUS-824**
  - Added new Collection parameter `reportToEms` to configure whether the collection is reported to EMS
- **CUMULUS-1357**
  - Added new BackendApi endpoint `ems` that generates EMS reports.
- **CUMULUS-1241**
  - Added information about queues with maximum execution limits defined to default workflow templates (`meta.queueExecutionLimits`)
- **CUMULUS-1311**
  - Added `@cumulus/common/message` with various message parsing/preparation helpers
- **CUMULUS-812**

  - Added support for limiting the number of concurrent executions started from a queue. [See the data cookbook](https://nasa.github.io/cumulus/docs/data-cookbooks/throttling-queued-executions) for more information.

- **CUMULUS-1337**

  - Adds `cumulus.stackName` value to the `instanceMetadata` endpoint.

- **CUMULUS-1368**

  - Added `cmrGranuleUrlType` to the `@cumulus/move-granules` task. This determines what kind of links go in the CMR files. The options are `distribution`, `s3`, or `none`, with the default being distribution. If there is no distribution API being used with Cumulus, you must set the value to `s3` or `none`.

- Added `packages/s3-replicator` Terraform module to allow same-region s3 replication to metrics bucket.

- **CUMULUS-1392**

  - Added `tf-modules/report-granules` Terraform module which processes granule ingest notifications received via SNS and stores granule data to a database. The module includes:
    - SNS topic for publishing granule ingest notifications
    - Lambda to process granule notifications and store data
    - IAM permissions for the Lambda
    - Subscription for the Lambda to the SNS topic

- **CUMULUS-1393**

  - Added `tf-modules/report-pdrs` Terraform module which processes PDR ingest notifications received via SNS and stores PDR data to a database. The module includes:
    - SNS topic for publishing PDR ingest notifications
    - Lambda to process PDR notifications and store data
    - IAM permissions for the Lambda
    - Subscription for the Lambda to the SNS topic
  - Added unit tests for `@cumulus/api/models/pdrs.createPdrFromSns()`

- **CUMULUS-1400**

  - Added `tf-modules/report-executions` Terraform module which processes workflow execution information received via SNS and stores it to a database. The module includes:
    - SNS topic for publishing execution data
    - Lambda to process and store execution data
    - IAM permissions for the Lambda
    - Subscription for the Lambda to the SNS topic
  - Added `@cumulus/common/sns-event` which contains helpers for SNS events:
    - `isSnsEvent()` returns true if event is from SNS
    - `getSnsEventMessage()` extracts and parses the message from an SNS event
    - `getSnsEventMessageObject()` extracts and parses message object from an SNS event
  - Added `@cumulus/common/cloudwatch-event` which contains helpers for Cloudwatch events:
    - `isSfExecutionEvent()` returns true if event is from Step Functions
    - `isTerminalSfStatus()` determines if a Step Function status from a Cloudwatch event is a terminal status
    - `getSfEventStatus()` gets the Step Function status from a Cloudwatch event
    - `getSfEventDetailValue()` extracts a Step Function event detail field from a Cloudwatch event
    - `getSfEventMessageObject()` extracts and parses Step Function detail object from a Cloudwatch event

- **CUMULUS-1429**

  - Added `tf-modules/data-persistence` Terraform module which includes resources for data persistence in Cumulus:
    - DynamoDB tables
    - Elasticsearch with optional support for VPC
    - Cloudwatch alarm for number of Elasticsearch nodes

- **CUMULUS-1379** CMR Launchpad Authentication
  - Added `launchpad` configuration to `@cumulus/deployment/app/config.yml`, and cloudformation templates, workflow message, lambda configuration, api endpoint configuration
  - Added `@cumulus/common/LaunchpadToken` and `@cumulus/common/launchpad` to provide methods to get token and validate token
  - Updated lambdas to use Launchpad token for CMR actions (ingest and delete granules)
  - Updated deployment documentation and added [instructions to setup CMR client for Launchpad authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/CMR+Launchpad+Authentication)

## Changed

- **CUMULUS-1232**

  - Added retries to update `@cumulus/cmr-client` `updateToken()`

- **CUMULUS-1245 CUMULUS-795**

  - Added additional `ems` configuration parameters for sending the ingest reports to EMS
  - Added functionality to send daily ingest reports to EMS

- **CUMULUS-1241**

  - Removed the concept of "priority levels" and added ability to define a number of maximum concurrent executions per SQS queue
  - Changed mapping of Cumulus message properties for the `sqs2sfThrottle` lambda:
    - Queue name is read from `cumulus_meta.queueName`
    - Maximum executions for the queue is read from `meta.queueExecutionLimits[queueName]`, where `queueName` is `cumulus_meta.queueName`
  - Changed `sfSemaphoreDown` lambda to only attempt decrementing semaphores when:
    - the message is for a completed/failed/aborted/timed out workflow AND
    - `cumulus_meta.queueName` exists on the Cumulus message AND
    - An entry for the queue name (`cumulus_meta.queueName`) exists in the the object `meta.queueExecutionLimits` on the Cumulus message

- **CUMULUS-1338**

  - Updated `sfSemaphoreDown` lambda to be triggered via AWS Step Function Cloudwatch events instead of subscription to `sfTracker` SNS topic

- **CUMULUS-1311**

  - Updated `@cumulus/queue-granules` to set `cumulus_meta.queueName` for queued execution messages
  - Updated `@cumulus/queue-pdrs` to set `cumulus_meta.queueName` for queued execution messages
  - Updated `sqs2sfThrottle` lambda to immediately decrement queue semaphore value if dispatching Step Function execution throws an error

- **CUMULUS-1362**

  - Granule `processingStartTime` and `processingEndTime` will be set to the execution start time and end time respectively when there is no sync granule or post to cmr task present in the workflow

- **CUMULUS-1400**
  - Deprecated `@cumulus/ingest/aws/getExecutionArn`. Use `@cumulus/common/aws/getExecutionArn` instead.

### Fixed

- **CUMULUS-1439**

  - Fix bug with rule.logEventArn deletion on Kinesis rule update and fix unit test to verify

- **CUMULUS-796**

  - Added production information (collection ShortName and Version, granuleId) to EMS distribution report
  - Added functionality to send daily distribution reports to EMS

- **CUMULUS-1319**

  - Fixed a bug where granule ingest times were not being stored to the database

- **CUMULUS-1356**

  - The `Collection` model's `delete` method now _removes_ the specified item
    from the collection config store that was inserted by the `create` method.
    Previously, this behavior was missing.

- **CUMULUS-1374**
  - Addressed audit concerns (https://www.npmjs.com/advisories/782) in api package

### BREAKING CHANGES

### Changed

- **CUMULUS-1418**
  - Adding a default `cmaDir` key to configuration will cause `CUMULUS_MESSAGE_ADAPTER_DIR` to be set by default to `/opt` for any Lambda not setting `useCma` to true, or explicitly setting the CMA environment variable. In lambdas that package the CMA independently of the Cumulus packaging. Lambdas manually packaging the CMA should have their Lambda configuration updated to set the CMA path, or alternately if not using the CMA as a Lambda layer in this deployment set `cmaDir` to `./cumulus-message-adapter`.

### Removed

- **CUMULUS-1337**

  - Removes the S3 Access Metrics package added in CUMULUS-799

- **PR1130**
  - Removed code deprecated since v1.11.1:
    - Removed `@cumulus/common/step-functions`. Use `@cumulus/common/StepFunctions` instead.
    - Removed `@cumulus/api/lib/testUtils.fakeFilesFactory`. Use `@cumulus/api/lib/testUtils.fakeFileFactory` instead.
    - Removed `@cumulus/cmrjs/cmr` functions: `searchConcept`, `ingestConcept`, `deleteConcept`. Use the functions in `@cumulus/cmr-client` instead.
    - Removed `@cumulus/ingest/aws.getExecutionHistory`. Use `@cumulus/common/StepFunctions.getExecutionHistory` instead.

## [v1.13.5] - 2019-08-29 - [BACKPORT]

### Fixed

- **CUMULUS-1455** - CMR token links updated to point to CMR legacy services rather than echo

## [v1.13.4] - 2019-07-29

- **CUMULUS-1411** - Fix deployment issue when using a template override

## [v1.13.3] - 2019-07-26

- **CUMULUS-1345** Full backport of CUMULUS-1345 features - Adds new variables to the app deployment under `cmr`.
  - `cmrEnvironment` values are `SIT`, `UAT`, or `OPS` with `UAT` as the default.
  - `cmrLimit` and `cmrPageSize` have been added as configurable options.

## [v1.13.2] - 2019-07-25

- Re-release of v1.13.1 to fix broken npm packages.

## [v1.13.1] - 2019-07-22

- **CUMULUS-1374** - Resolve audit compliance with lodash version for api package subdependency
- **CUMULUS-1412** - Resolve audit compliance with googleapi package
- **CUMULUS-1345** - Backported CMR environment setting in getUrl to address immediate user need. CMR_ENVIRONMENT can now be used to set the CMR environment to OPS/SIT

## [v1.13.0] - 2019-5-20

### PLEASE NOTE

**CUMULUS-802** added some additional IAM permissions to support ECS autoscaling, so **you will have to redeploy your IAM stack.**
As a result of the changes for **CUMULUS-1193**, **CUMULUS-1264**, and **CUMULUS-1310**, **you must delete your existing stacks (except IAM) before deploying this version of Cumulus.**
If running Cumulus within a VPC and extended downtime is acceptable, we recommend doing this at the end of the day to allow AWS backend resources and network interfaces to be cleaned up overnight.

### BREAKING CHANGES

- **CUMULUS-1228**

  - The default AMI used by ECS instances is now an NGAP-compliant AMI. This
    will be a breaking change for non-NGAP deployments. If you do not deploy to
    NGAP, you will need to find the AMI ID of the
    [most recent Amazon ECS-optimized AMI](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html),
    and set the `ecs.amiid` property in your config. Instructions for finding
    the most recent NGAP AMI can be found using
    [these instructions](https://wiki.earthdata.nasa.gov/display/ESKB/Select+an+NGAP+Created+AMI).

- **CUMULUS-1310**

  - Database resources (DynamoDB, ElasticSearch) have been moved to an independent `db` stack.
    Migrations for this version will need to be user-managed. (e.g. [elasticsearch](https://docs.aws.amazon.com/elasticsearch-service/latest/developerguide/es-version-migration.html#snapshot-based-migration) and [dynamoDB](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/dp-template-exports3toddb.html)).
    Order of stack deployment is `iam` -> `db` -> `app`.
  - All stacks can now be deployed using a single `config.yml` file, i.e.: `kes cf deploy --kes-folder app --template node_modules/@cumulus/deployment/[iam|db|app] [...]`
    Backwards-compatible. For development, please re-run `npm run bootstrap` to build new `kes` overrides.
    Deployment docs have been updated to show how to deploy a single-config Cumulus instance.
  - `params` have been moved: Nest `params` fields under `app`, `db` or `iam` to override all Parameters for a particular stack's cloudformation template. Backwards-compatible with multi-config setups.
  - `stackName` and `stackNameNoDash` have been retired. Use `prefix` and `prefixNoDash` instead.
  - The `iams` section in `app/config.yml` IAM roles has been deprecated as a user-facing parameter,
    _unless_ your IAM role ARNs do not match the convention shown in `@cumulus/deployment/app/config.yml`
  - The `vpc.securityGroup` will need to be set with a pre-existing security group ID to use Cumulus in a VPC. Must allow inbound HTTP(S) (Port 443).

- **CUMULUS-1212**

  - `@cumulus/post-to-cmr` will now fail if any granules being processed are missing a metadata file. You can set the new config option `skipMetaCheck` to `true` to pass post-to-cmr without a metadata file.

- **CUMULUS-1232**

  - `@cumulus/sync-granule` will no longer silently pass if no checksum data is provided. It will use input
    from the granule object to:
    - Verify checksum if `checksumType` and `checksumValue` are in the file record OR a checksum file is provided
      (throws `InvalidChecksum` on fail), else log warning that no checksum is available.
    - Then, verify synced S3 file size if `file.size` is in the file record (throws `UnexpectedFileSize` on fail),
      else log warning that no file size is available.
    - Pass the step.

- **CUMULUS-1264**

  - The Cloudformation templating and deployment configuration has been substantially refactored.
    - `CumulusApiDefault` nested stack resource has been renamed to `CumulusApiDistribution`
    - `CumulusApiV1` nested stack resource has been renamed to `CumulusApiBackend`
  - The `urs: true` config option for when defining your lambdas (e.g. in `lambdas.yml`) has been deprecated. There are two new options to replace it:
    - `urs_redirect: 'token'`: This will expose a `TOKEN_REDIRECT_ENDPOINT` environment variable to your lambda that references the `/token` endpoint on the Cumulus backend API
    - `urs_redirect: 'distribution'`: This will expose a `DISTRIBUTION_REDIRECT_ENDPOINT` environment variable to your lambda that references the `/redirect` endpoint on the Cumulus distribution API

- **CUMULUS-1193**

  - The elasticsearch instance is moved behind the VPC.
  - Your account will need an Elasticsearch Service Linked role. This is a one-time setup for the account. You can follow the instructions to use the AWS console or AWS CLI [here](https://docs.aws.amazon.com/IAM/latest/UserGuide/using-service-linked-roles.html) or use the following AWS CLI command: `aws iam create-service-linked-role --aws-service-name es.amazonaws.com`

- **CUMULUS-802**

  - ECS `maxInstances` must be greater than `minInstances`. If you use defaults, no change is required.

- **CUMULUS-1269**
  - Brought Cumulus data models in line with CNM JSON schema:
    - Renamed file object `fileType` field to `type`
    - Renamed file object `fileSize` field to `size`
    - Renamed file object `checksumValue` field to `checksum` where not already done.
    - Added `ancillary` and `linkage` type support to file objects.

### Added

- **CUMULUS-799**

  - Added an S3 Access Metrics package which will take S3 Server Access Logs and
    write access metrics to CloudWatch

- **CUMULUS-1242** - Added `sqs2sfThrottle` lambda. The lambda reads SQS messages for queued executions and uses semaphores to only start new executions if the maximum number of executions defined for the priority key (`cumulus_meta.priorityKey`) has not been reached. Any SQS messages that are read but not used to start executions remain in the queue.

- **CUMULUS-1240**

  - Added `sfSemaphoreDown` lambda. This lambda receives SNS messages and for each message it decrements the semaphore used to track the number of running executions if:
    - the message is for a completed/failed workflow AND
    - the message contains a level of priority (`cumulus_meta.priorityKey`)
  - Added `sfSemaphoreDown` lambda as a subscriber to the `sfTracker` SNS topic

- **CUMULUS-1265**

  - Added `apiConfigs` configuration option to configure API Gateway to be private
  - All internal lambdas configured to run inside the VPC by default
  - Removed references to `NoVpc` lambdas from documentation and `example` folder.

- **CUMULUS-802**
  - Adds autoscaling of ECS clusters
  - Adds autoscaling of ECS services that are handling StepFunction activities

## Changed

- Updated `@cumulus/ingest/http/httpMixin.list()` to trim trailing spaces on discovered filenames

- **CUMULUS-1310**

  - Database resources (DynamoDB, ElasticSearch) have been moved to an independent `db` stack.
    This will enable future updates to avoid affecting database resources or requiring migrations.
    Migrations for this version will need to be user-managed.
    (e.g. [elasticsearch](https://docs.aws.amazon.com/elasticsearch-service/latest/developerguide/es-version-migration.html#snapshot-based-migration) and [dynamoDB](https://docs.aws.amazon.com/datapipeline/latest/DeveloperGuide/dp-template-exports3toddb.html)).
    Order of stack deployment is `iam` -> `db` -> `app`.
  - All stacks can now be deployed using a single `config.yml` file, i.e.: `kes cf deploy --kes-folder app --template node_modules/@cumulus/deployment/[iam|db|app] [...]`
    Backwards-compatible. Please re-run `npm run bootstrap` to build new `kes` overrides.
    Deployment docs have been updated to show how to deploy a single-config Cumulus instance.
  - `params` fields should now be nested under the stack key (i.e. `app`, `db` or `iam`) to provide Parameters for a particular stack's cloudformation template,
    for use with single-config instances. Keys _must_ match the name of the deployment package folder (`app`, `db`, or `iam`).
    Backwards-compatible with multi-config setups.
  - `stackName` and `stackNameNoDash` have been retired as user-facing config parameters. Use `prefix` and `prefixNoDash` instead.
    This will be used to create stack names for all stacks in a single-config use case.
    `stackName` may still be used as an override in multi-config usage, although this is discouraged.
    Warning: overriding the `db` stack's `stackName` will require you to set `dbStackName` in your `app/config.yml`.
    This parameter is required to fetch outputs from the `db` stack to reference in the `app` stack.
  - The `iams` section in `app/config.yml` IAM roles has been retired as a user-facing parameter,
    _unless_ your IAM role ARNs do not match the convention shown in `@cumulus/deployment/app/config.yml`
    In that case, overriding `iams` in your own config is recommended.
  - `iam` and `db` `cloudformation.yml` file names will have respective prefixes (e.g `iam.cloudformation.yml`).
  - Cumulus will now only attempt to create reconciliation reports for buckets of the `private`, `public` and `protected` types.
  - Cumulus will no longer set up its own security group.
    To pass a pre-existing security group for in-VPC deployments as a parameter to the Cumulus template, populate `vpc.securityGroup` in `config.yml`.
    This security group must allow inbound HTTP(S) traffic (Port 443). SSH traffic (Port 22) must be permitted for SSH access to ECS instances.
  - Deployment docs have been updated with examples for the new deployment model.

- **CUMULUS-1236**

  - Moves access to public files behind the distribution endpoint. Authentication is not required, but direct http access has been disallowed.

- **CUMULUS-1223**

  - Adds unauthenticated access for public bucket files to the Distribution API. Public files should be requested the same way as protected files, but for public files a redirect to a self-signed S3 URL will happen without requiring authentication with Earthdata login.

- **CUMULUS-1232**

  - Unifies duplicate handling in `ingest/granule.handleDuplicateFile` for maintainability.
  - Changed `ingest/granule.ingestFile` and `move-granules/index.moveFileRequest` to use new function.
  - Moved file versioning code to `ingest/granule.moveGranuleFileWithVersioning`
  - `ingest/granule.verifyFile` now also tests `file.size` for verification if it is in the file record and throws
    `UnexpectedFileSize` error for file size not matching input.
  - `ingest/granule.verifyFile` logs warnings if checksum and/or file size are not available.

- **CUMULUS-1193**

  - Moved reindex CLI functionality to an API endpoint. See [API docs](https://nasa.github.io/cumulus-api/#elasticsearch-1)

- **CUMULUS-1207**
  - No longer disable lambda event source mappings when disabling a rule

### Fixed

- Updated Lerna publish script so that published Cumulus packages will pin their dependencies on other Cumulus packages to exact versions (e.g. `1.12.1` instead of `^1.12.1`)

- **CUMULUS-1203**

  - Fixes IAM template's use of intrinsic functions such that IAM template overrides now work with kes

- **CUMULUS-1268**
  - Deployment will not fail if there are no ES alarms or ECS services

## [v1.12.1] - 2019-4-8

## [v1.12.0] - 2019-4-4

Note: There was an issue publishing 1.12.0. Upgrade to 1.12.1.

### BREAKING CHANGES

- **CUMULUS-1139**

  - `granule.applyWorkflow` uses the new-style granule record as input to workflows.

- **CUMULUS-1171**

  - Fixed provider handling in the API to make it consistent between protocols.
    NOTE: This is a breaking change. When applying this upgrade, users will need to:
    1. Disable all workflow rules
    2. Update any `http` or `https` providers so that the host field only
       contains a valid hostname or IP address, and the port field contains the
       provider port.
    3. Perform the deployment
    4. Re-enable workflow rules

- **CUMULUS-1176**:

  - `@cumulus/move-granules` input expectations have changed. `@cumulus/files-to-granules` is a new intermediate task to perform input translation in the old style.
    See the Added and Changed sections of this release changelog for more information.

- **CUMULUS-670**

  - The behavior of ParsePDR and related code has changed in this release. PDRs with FILE_TYPEs that do not conform to the PDR ICD (+ TGZ) (https://cdn.earthdata.nasa.gov/conduit/upload/6376/ESDS-RFC-030v1.0.pdf) will fail to parse.

- **CUMULUS-1208**
  - The granule object input to `@cumulus/queue-granules` will now be added to ingest workflow messages **as is**. In practice, this means that if you are using `@cumulus/queue-granules` to trigger ingest workflows and your granule objects input have invalid properties, then your ingest workflows will fail due to schema validation errors.

### Added

- **CUMULUS-777**
  - Added new cookbook entry on configuring Cumulus to track ancillary files.
- **CUMULUS-1183**
  - Kes overrides will now abort with a warning if a workflow step is configured without a corresponding
    lambda configuration
- **CUMULUS-1223**

  - Adds convenience function `@cumulus/common/bucketsConfigJsonObject` for fetching stack's bucket configuration as an object.

- **CUMULUS-853**
  - Updated FakeProcessing example lambda to include option to generate fake browse
  - Added feature documentation for ancillary metadata export, a new cookbook entry describing a workflow with ancillary metadata generation(browse), and related task definition documentation
- **CUMULUS-805**
  - Added a CloudWatch alarm to check running ElasticSearch instances, and a CloudWatch dashboard to view the health of ElasticSearch
  - Specify `AWS_REGION` in `.env` to be used by deployment script
- **CUMULUS-803**
  - Added CloudWatch alarms to check running tasks of each ECS service, and add the alarms to CloudWatch dashboard
- **CUMULUS-670**
  - Added Ancillary Metadata Export feature (see https://nasa.github.io/cumulus/docs/features/ancillary_metadata for more information)
  - Added new Collection file parameter "fileType" that allows configuration of workflow granule file fileType
- **CUMULUS-1184** - Added kes logging output to ensure we always see the state machine reference before failures due to configuration
- **CUMULUS-1105** - Added a dashboard endpoint to serve the dashboard from an S3 bucket
- **CUMULUS-1199** - Moves `s3credentials` endpoint from the backend to the distribution API.
- **CUMULUS-666**
  - Added `@api/endpoints/s3credentials` to allow EarthData Login authorized users to retrieve temporary security credentials for same-region direct S3 access.
- **CUMULUS-671**
  - Added `@packages/integration-tests/api/distribution/getDistributionApiS3SignedUrl()` to return the S3 signed URL for a file protected by the distribution API
- **CUMULUS-672**
  - Added `cmrMetadataFormat` and `cmrConceptId` to output for individual granules from `@cumulus/post-to-cmr`. `cmrMetadataFormat` will be read from the `cmrMetadataFormat` generated for each granule in `@cumulus/cmrjs/publish2CMR()`
  - Added helpers to `@packages/integration-tests/api/distribution`:
    - `getDistributionApiFileStream()` returns a stream to download files protected by the distribution API
    - `getDistributionFileUrl()` constructs URLs for requesting files from the distribution API
- **CUMULUS-1185** `@cumulus/api/models/Granule.removeGranuleFromCmrByGranule` to replace `@cumulus/api/models/Granule.removeGranuleFromCmr` and use the Granule UR from the CMR metadata to remove the granule from CMR

- **CUMULUS-1101**

  - Added new `@cumulus/checksum` package. This package provides functions to calculate and validate checksums.
  - Added new checksumming functions to `@cumulus/common/aws`: `calculateS3ObjectChecksum` and `validateS3ObjectChecksum`, which depend on the `checksum` package.

- CUMULUS-1171

  - Added `@cumulus/common` API documentation to `packages/common/docs/API.md`
  - Added an `npm run build-docs` task to `@cumulus/common`
  - Added `@cumulus/common/string#isValidHostname()`
  - Added `@cumulus/common/string#match()`
  - Added `@cumulus/common/string#matches()`
  - Added `@cumulus/common/string#toLower()`
  - Added `@cumulus/common/string#toUpper()`
  - Added `@cumulus/common/URLUtils#buildURL()`
  - Added `@cumulus/common/util#isNil()`
  - Added `@cumulus/common/util#isNull()`
  - Added `@cumulus/common/util#isUndefined()`
  - Added `@cumulus/common/util#negate()`

- **CUMULUS-1176**

  - Added new `@cumulus/files-to-granules` task to handle converting file array output from `cumulus-process` tasks into granule objects.
    Allows simplification of `@cumulus/move-granules` and `@cumulus/post-to-cmr`, see Changed section for more details.

- CUMULUS-1151 Compare the granule holdings in CMR with Cumulus' internal data store
- CUMULUS-1152 Compare the granule file holdings in CMR with Cumulus' internal data store

### Changed

- **CUMULUS-1216** - Updated `@cumulus/ingest/granule/ingestFile` to download files to expected staging location.
- **CUMULUS-1208** - Updated `@cumulus/ingest/queue/enqueueGranuleIngestMessage()` to not transform granule object passed to it when building an ingest message
- **CUMULUS-1198** - `@cumulus/ingest` no longer enforces any expectations about whether `provider_path` contains a leading slash or not.
- **CUMULUS-1170**
  - Update scripts and docs to use `npm` instead of `yarn`
  - Use `package-lock.json` files to ensure matching versions of npm packages
  - Update CI builds to use `npm ci` instead of `npm install`
- **CUMULUS-670**
  - Updated ParsePDR task to read standard PDR types+ (+ tgz as an external customer requirement) and add a fileType to granule-files on Granule discovery
  - Updated ParsePDR to fail if unrecognized type is used
  - Updated all relevant task schemas to include granule->files->filetype as a string value
  - Updated tests/test fixtures to include the fileType in the step function/task inputs and output validations as needed
  - Updated MoveGranules task to handle incoming configuration with new "fileType" values and to add them as appropriate to the lambda output.
  - Updated DiscoverGranules step/related workflows to read new Collection file parameter fileType that will map a discovered file to a workflow fileType
  - Updated CNM parser to add the fileType to the defined granule file fileType on ingest and updated integration tests to verify/validate that behavior
  - Updated generateEcho10XMLString in cmr-utils.js to use a map/related library to ensure order as CMR requires ordering for their online resources.
  - Updated post-to-cmr task to appropriately export CNM filetypes to CMR in echo10/UMM exports
- **CUMULUS-1139** - Granules stored in the API contain a `files` property. That schema has been greatly
  simplified and now better matches the CNM format.
  - The `name` property has been renamed to `fileName`.
  - The `filepath` property has been renamed to `key`.
  - The `checksumValue` property has been renamed to `checksum`.
  - The `path` property has been removed.
  - The `url_path` property has been removed.
  - The `filename` property (which contained an `s3://` URL) has been removed, and the `bucket`
    and `key` properties should be used instead. Any requests sent to the API containing a `granule.files[].filename`
    property will be rejected, and any responses coming back from the API will not contain that
    `filename` property.
  - A `source` property has been added, which is a URL indicating the original source of the file.
  - `@cumulus/ingest/granule.moveGranuleFiles()` no longer includes a `filename` field in its
    output. The `bucket` and `key` fields should be used instead.
- **CUMULUS-672**

  - Changed `@cumulus/integration-tests/api/EarthdataLogin.getEarthdataLoginRedirectResponse` to `@cumulus/integration-tests/api/EarthdataLogin.getEarthdataAccessToken`. The new function returns an access response from Earthdata login, if successful.
  - `@cumulus/integration-tests/cmr/getOnlineResources` now accepts an object of options, including `cmrMetadataFormat`. Based on the `cmrMetadataFormat`, the function will correctly retrieve the online resources for each metadata format (ECHO10, UMM-G)

- **CUMULUS-1101**

  - Moved `@cumulus/common/file/getFileChecksumFromStream` into `@cumulus/checksum`, and renamed it to `generateChecksumFromStream`.
    This is a breaking change for users relying on `@cumulus/common/file/getFileChecksumFromStream`.
  - Refactored `@cumulus/ingest/Granule` to depend on new `common/aws` checksum functions and remove significantly present checksumming code.
    - Deprecated `@cumulus/ingest/granule.validateChecksum`. Replaced with `@cumulus/ingest/granule.verifyFile`.
    - Renamed `granule.getChecksumFromFile` to `granule.retrieveSuppliedFileChecksumInformation` to be more accurate.
  - Deprecated `@cumulus/common/aws.checksumS3Objects`. Use `@cumulus/common/aws.calculateS3ObjectChecksum` instead.

- CUMULUS-1171

  - Fixed provider handling in the API to make it consistent between protocols.
    Before this change, FTP providers were configured using the `host` and
    `port` properties. HTTP providers ignored `port` and `protocol`, and stored
    an entire URL in the `host` property. Updated the API to only accept valid
    hostnames or IP addresses in the `provider.host` field. Updated ingest code
    to properly build HTTP and HTTPS URLs from `provider.protocol`,
    `provider.host`, and `provider.port`.
  - The default provider port was being set to 21, no matter what protocol was
    being used. Removed that default.

- **CUMULUS-1176**

  - `@cumulus/move-granules` breaking change:
    Input to `move-granules` is now expected to be in the form of a granules object (i.e. `{ granules: [ { ... }, { ... } ] }`);
    For backwards compatibility with array-of-files outputs from processing steps, use the new `@cumulus/files-to-granules` task as an intermediate step.
    This task will perform the input translation. This change allows `move-granules` to be simpler and behave more predictably.
    `config.granuleIdExtraction` and `config.input_granules` are no longer needed/used by `move-granules`.
  - `@cumulus/post-to-cmr`: `config.granuleIdExtraction` is no longer needed/used by `post-to-cmr`.

- CUMULUS-1174
  - Better error message and stacktrace for S3KeyPairProvider error reporting.

### Fixed

- **CUMULUS-1218** Reconciliation report will now scan only completed granules.
- `@cumulus/api` files and granules were not getting indexed correctly because files indexing was failing in `db-indexer`
- `@cumulus/deployment` A bug in the Cloudformation template was preventing the API from being able to be launched in a VPC, updated the IAM template to give the permissions to be able to run the API in a VPC

### Deprecated

- `@cumulus/api/models/Granule.removeGranuleFromCmr`, instead use `@cumulus/api/models/Granule.removeGranuleFromCmrByGranule`
- `@cumulus/ingest/granule.validateChecksum`, instead use `@cumulus/ingest/granule.verifyFile`
- `@cumulus/common/aws.checksumS3Objects`, instead use `@cumulus/common/aws.calculateS3ObjectChecksum`
- `@cumulus/cmrjs`: `getGranuleId` and `getCmrFiles` are deprecated due to changes in input handling.

## [v1.11.3] - 2019-3-5

### Added

- **CUMULUS-1187** - Added `@cumulus/ingest/granule/duplicateHandlingType()` to determine how duplicate files should be handled in an ingest workflow

### Fixed

- **CUMULUS-1187** - workflows not respecting the duplicate handling value specified in the collection
- Removed refreshToken schema requirement for OAuth

## [v1.11.2] - 2019-2-15

### Added

- CUMULUS-1169
  - Added a `@cumulus/common/StepFunctions` module. It contains functions for querying the AWS
    StepFunctions API. These functions have the ability to retry when a ThrottlingException occurs.
  - Added `@cumulus/common/aws.retryOnThrottlingException()`, which will wrap a function in code to
    retry on ThrottlingExceptions.
  - Added `@cumulus/common/test-utils.throttleOnce()`, which will cause a function to return a
    ThrottlingException the first time it is called, then return its normal result after that.
- CUMULUS-1103 Compare the collection holdings in CMR with Cumulus' internal data store
- CUMULUS-1099 Add support for UMMG JSON metadata versions > 1.4.
  - If a version is found in the metadata object, that version is used for processing and publishing to CMR otherwise, version 1.4 is assumed.
- CUMULUS-678
  - Added support for UMMG json v1.4 metadata files.
    `reconcileCMRMetadata` added to `@cumulus/cmrjs` to update metadata record with new file locations.
    `@cumulus/common/errors` adds two new error types `CMRMetaFileNotFound` and `InvalidArgument`.
    `@cumulus/common/test-utils` adds new function `randomId` to create a random string with id to help in debugging.
    `@cumulus/common/BucketsConfig` adds a new helper class `BucketsConfig` for working with bucket stack configuration and bucket names.
    `@cumulus/common/aws` adds new function `s3PutObjectTagging` as a convenience for the aws [s3().putObjectTagging](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObjectTagging-property) function.
    `@cumulus/cmrjs` Adds: - `isCMRFile` - Identify an echo10(xml) or UMMG(json) metadata file. - `metadataObjectFromCMRFile` Read and parse CMR XML file from s3. - `updateCMRMetadata` Modify a cmr metadata (xml/json) file with updated information. - `publish2CMR` Posts XML or UMMG CMR data to CMR service. - `reconcileCMRMetadata` Reconciles cmr metadata file after a file moves.
- Adds some ECS and other permissions to StepRole to enable running ECS tasks from a workflow
- Added Apache logs to cumulus api and distribution lambdas
- **CUMULUS-1119** - Added `@cumulus/integration-tests/api/EarthdataLogin.getEarthdataLoginRedirectResponse` helper for integration tests to handle login with Earthdata and to return response from redirect to Cumulus API
- **CUMULUS-673** Added `@cumulus/common/file/getFileChecksumFromStream` to get file checksum from a readable stream

### Fixed

- CUMULUS-1123
  - Cloudformation template overrides now work as expected

### Changed

- CUMULUS-1169
  - Deprecated the `@cumulus/common/step-functions` module.
  - Updated code that queries the StepFunctions API to use the retry-enabled functions from
    `@cumulus/common/StepFunctions`
- CUMULUS-1121
  - Schema validation is now strongly enforced when writing to the database.
    Additional properties are not allowed and will result in a validation error.
- CUMULUS-678
  `tasks/move-granules` simplified and refactored to use functionality from cmrjs.
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
  `@cumulus/ingest/aws` function: `KMSDecryptionFailed` and class: `KMS` extracted and moved to `@cumulus/common` and `KMS` is exported as `KMSProvider` from `@cumulus/common/key-pair-provider`
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
  - CUMULUS-817 includes a migration that requires reconfiguration/redeployment of IAM roles. Please see the [upgrade instructions](https://nasa.github.io/cumulus/docs/upgrade/1.11.0) for more information.
  - CUMULUS-977 includes a few new SNS-related permissions added to the IAM roles that will require redeployment of IAM roles.
- `cumulus-message-adapter` v1.0.13+ is required for `@cumulus/api` granule reingest API to work properly. The latest version should be downloaded automatically by kes.
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
  - Add `KinesisInboundEventLogger` and `KinesisOutboundEventLogger` API lambdas. These lambdas
    are utilized to dump incoming and outgoing ingest workflow kinesis streams
    to cloudwatch for analytics in case of AWS/stream failure.
  - Update rules model to allow tracking of log_event ARNs related to
    Rule event logging. Kinesis rule types will now automatically log
    incoming events via a Kinesis event triggered lambda.
    CUMULUS-975-migration-4
  - Update migration code to require explicit migration names per run
  - Added migration_4 to migrate/update existing Kinesis rules to have a log event mapping
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
    which could lead to tests interfering with each other.
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

  - Updated Kes custom code to remove logic that used the CMA file key to determine template compilation logic. Instead, utilize a `customCompilation` template configuration flag to indicate a template should use Cumulus's kes customized methods instead of 'core'.
  - Added `useWorkflowLambdaVersions` configuration option to enable the lambdaVersioning feature set. **This option is set to true by default** and should be set to false to disable the feature.
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
- `@cumulus/api`: `/execution-status` endpoint requests and returns complete execution output if execution output is stored in S3 due to size.
- Added option to use environment variable to set CMR host in `@cumulus/cmrjs`.
- **CUMULUS-781** - Added integration tests for `@cumulus/sync-granule` when `duplicateHandling` is set to `replace` or `skip`
- **CUMULUS-791** - `@cumulus/move-granules`: `moveFileRequest` inserts new `duplicate_found: true` field in the file's record if a duplicate file already exists on S3. Updated output schema to document new `duplicate_found` field.

### Removed

- Removed `@cumulus/common/fake-earthdata-login-server`. Tests can now create a
  service stub based on `@cumulus/api/lib/OAuth2` if testing requires handling
  authentication.

### Changed

- **CUMULUS-940** - modified `@cumulus/common/aws` `receiveSQSMessages` to take a parameter object instead of positional parameters. All defaults remain the same, but now access to long polling is available through `options.waitTimeSeconds`.
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
- **CUMULUS-413** Kinesis processing now captures all errors.
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

- **GITC-776-3** Added more flexibility for rules. You can now edit all fields on the rule's record
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

## [v1.7.1] - 2018-07-27 - [BACKPORT]

### Fixed

- **CUMULUS-766** - Backport from 1.8.0 - Populate database fileSize field from S3 if value not present in Ingest payload

## [v1.7.0] - 2018-07-02

### Please note: [Upgrade Instructions](https://nasa.github.io/cumulus/docs/upgrade/1.7.0)

### Added

- **GITC-776-2** - Add support for versioned collections
- **CUMULUS-491** - Add granule reconciliation API endpoints.
- **CUMULUS-480** Add support for backup and recovery:
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
  - Change the structure of the buckets to allow for more than one bucket of each type. The bucket structure is now:
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
  - `example` workflow messages are populated from workflow templates in s3, provider and collection information in database, and input payloads. Input templates are removed.
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
- **CUMULUS-304: "Add AWS API throttling to pdr-status-check task"** Added concurrency limit on SFN API calls. The default concurrency is 10 and is configurable through Lambda environment variable CONCURRENCY.
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
- **CUMULUS-260: "PDR page on dashboard only shows zeros."** The PDR stats in LPDAAC are all 0s, even if the dashboard has been fixed to retrieve the correct fields. The current version of pdr-status-check has a few issues.
  - pdr is not included in the input/output schema. It's available from the input event. So the pdr status and stats are not updated when the ParsePdr workflow is complete. Adding the pdr to the input/output of the task will fix this.
  - pdr-status-check doesn't update pdr stats which prevent the real time pdr progress from showing up in the dashboard. To solve this, added lambda function sf-sns-report which is copied from @cumulus/api/lambdas/sf-sns-broadcast with modification, sf-sns-report can be used to report step function status anywhere inside a step function. So add step sf-sns-report after each pdr-status-check, we will get the PDR status progress at real time.
  - It's possible an execution is still in the queue and doesn't exist in sfn yet. Added code to handle 'ExecutionDoesNotExist' error when checking the execution status.
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


[unreleased]: https://github.com/nasa/cumulus/compare/v16.1.4...HEAD
[v16.1.4]: https://github.com/nasa/cumulus/compare/v16.1.3...v16.1.4
[v16.1.3]: https://github.com/nasa/cumulus/compare/v16.1.2...v16.1.3
[v16.1.2]: https://github.com/nasa/cumulus/compare/v16.1.1...v16.1.2
[v16.1.1]: https://github.com/nasa/cumulus/compare/v16.0.0...v16.1.1
[v16.0.0]: https://github.com/nasa/cumulus/compare/v15.0.4...v16.0.0
[v15.0.4]: https://github.com/nasa/cumulus/compare/v15.0.3...v15.0.4
[v15.0.3]: https://github.com/nasa/cumulus/compare/v15.0.2...v15.0.3
[v15.0.2]: https://github.com/nasa/cumulus/compare/v15.0.1...v15.0.2
[v15.0.1]: https://github.com/nasa/cumulus/compare/v15.0.0...v15.0.1
[v15.0.0]: https://github.com/nasa/cumulus/compare/v14.1.0...v15.0.0
[v14.1.0]: https://github.com/nasa/cumulus/compare/v14.0.0...v14.1.0
[v14.0.0]: https://github.com/nasa/cumulus/compare/v13.4.0...v14.0.0
[v13.4.0]: https://github.com/nasa/cumulus/compare/v13.3.2...v13.4.0
[v13.3.2]: https://github.com/nasa/cumulus/compare/v13.3.0...v13.3.2
[v13.3.0]: https://github.com/nasa/cumulus/compare/v13.2.1...v13.3.0
[v13.2.1]: https://github.com/nasa/cumulus/compare/v13.2.0...v13.2.1
[v13.2.0]: https://github.com/nasa/cumulus/compare/v13.1.0...v13.2.0
[v13.1.0]: https://github.com/nasa/cumulus/compare/v13.0.1...v13.1.0
[v13.0.1]: https://github.com/nasa/cumulus/compare/v13.0.0...v13.0.1
[v13.0.0]: https://github.com/nasa/cumulus/compare/v12.0.3...v13.0.0
[v12.0.3]: https://github.com/nasa/cumulus/compare/v12.0.2...v12.0.3
[v12.0.2]: https://github.com/nasa/cumulus/compare/v12.0.1...v12.0.2
[v12.0.1]: https://github.com/nasa/cumulus/compare/v12.0.0...v12.0.1
[v12.0.0]: https://github.com/nasa/cumulus/compare/v11.1.8...v12.0.0
[v11.1.8]: https://github.com/nasa/cumulus/compare/v11.1.7...v11.1.8
[v11.1.7]: https://github.com/nasa/cumulus/compare/v11.1.5...v11.1.7
[v11.1.5]: https://github.com/nasa/cumulus/compare/v11.1.4...v11.1.5
[v11.1.4]: https://github.com/nasa/cumulus/compare/v11.1.3...v11.1.4
[v11.1.3]: https://github.com/nasa/cumulus/compare/v11.1.2...v11.1.3
[v11.1.2]: https://github.com/nasa/cumulus/compare/v11.1.1...v11.1.2
[v11.1.1]: https://github.com/nasa/cumulus/compare/v11.1.0...v11.1.1
[v11.1.0]: https://github.com/nasa/cumulus/compare/v11.0.0...v11.1.0
[v11.0.0]: https://github.com/nasa/cumulus/compare/v10.1.3...v11.0.0
[v10.1.3]: https://github.com/nasa/cumulus/compare/v10.1.2...v10.1.3
[v10.1.2]: https://github.com/nasa/cumulus/compare/v10.1.1...v10.1.2
[v10.1.1]: https://github.com/nasa/cumulus/compare/v10.1.0...v10.1.1
[v10.1.0]: https://github.com/nasa/cumulus/compare/v10.0.1...v10.1.0
[v10.0.1]: https://github.com/nasa/cumulus/compare/v10.0.0...v10.0.1
[v10.0.0]: https://github.com/nasa/cumulus/compare/v9.9.0...v10.0.0
[v9.9.3]: https://github.com/nasa/cumulus/compare/v9.9.2...v9.9.3
[v9.9.2]: https://github.com/nasa/cumulus/compare/v9.9.1...v9.9.2
[v9.9.1]: https://github.com/nasa/cumulus/compare/v9.9.0...v9.9.1
[v9.9.0]: https://github.com/nasa/cumulus/compare/v9.8.0...v9.9.0
[v9.8.0]: https://github.com/nasa/cumulus/compare/v9.7.0...v9.8.0
[v9.7.1]: https://github.com/nasa/cumulus/compare/v9.7.0...v9.7.1
[v9.7.0]: https://github.com/nasa/cumulus/compare/v9.6.0...v9.7.0
[v9.6.0]: https://github.com/nasa/cumulus/compare/v9.5.0...v9.6.0
[v9.5.0]: https://github.com/nasa/cumulus/compare/v9.4.0...v9.5.0
[v9.4.1]: https://github.com/nasa/cumulus/compare/v9.3.0...v9.4.1
[v9.4.0]: https://github.com/nasa/cumulus/compare/v9.3.0...v9.4.0
[v9.3.0]: https://github.com/nasa/cumulus/compare/v9.2.2...v9.3.0
[v9.2.2]: https://github.com/nasa/cumulus/compare/v9.2.1...v9.2.2
[v9.2.1]: https://github.com/nasa/cumulus/compare/v9.2.0...v9.2.1
[v9.2.0]: https://github.com/nasa/cumulus/compare/v9.1.0...v9.2.0
[v9.1.0]: https://github.com/nasa/cumulus/compare/v9.0.1...v9.1.0
[v9.0.1]: https://github.com/nasa/cumulus/compare/v9.0.0...v9.0.1
[v9.0.0]: https://github.com/nasa/cumulus/compare/v8.1.0...v9.0.0
[v8.1.0]: https://github.com/nasa/cumulus/compare/v8.0.0...v8.1.0
[v8.0.0]: https://github.com/nasa/cumulus/compare/v7.2.0...v8.0.0
[v7.2.0]: https://github.com/nasa/cumulus/compare/v7.1.0...v7.2.0
[v7.1.0]: https://github.com/nasa/cumulus/compare/v7.0.0...v7.1.0
[v7.0.0]: https://github.com/nasa/cumulus/compare/v6.0.0...v7.0.0
[v6.0.0]: https://github.com/nasa/cumulus/compare/v5.0.1...v6.0.0
[v5.0.1]: https://github.com/nasa/cumulus/compare/v5.0.0...v5.0.1
[v5.0.0]: https://github.com/nasa/cumulus/compare/v4.0.0...v5.0.0
[v4.0.0]: https://github.com/nasa/cumulus/compare/v3.0.1...v4.0.0
[v3.0.1]: https://github.com/nasa/cumulus/compare/v3.0.0...v3.0.1
[v3.0.0]: https://github.com/nasa/cumulus/compare/v2.0.1...v3.0.0
[v2.0.7]: https://github.com/nasa/cumulus/compare/v2.0.6...v2.0.7
[v2.0.6]: https://github.com/nasa/cumulus/compare/v2.0.5...v2.0.6
[v2.0.5]: https://github.com/nasa/cumulus/compare/v2.0.4...v2.0.5
[v2.0.4]: https://github.com/nasa/cumulus/compare/v2.0.3...v2.0.4
[v2.0.3]: https://github.com/nasa/cumulus/compare/v2.0.2...v2.0.3
[v2.0.2]: https://github.com/nasa/cumulus/compare/v2.0.1...v2.0.2
[v2.0.1]: https://github.com/nasa/cumulus/compare/v1.24.0...v2.0.1
[v2.0.0]: https://github.com/nasa/cumulus/compare/v1.24.0...v2.0.0
[v1.24.0]: https://github.com/nasa/cumulus/compare/v1.23.2...v1.24.0
[v1.23.2]: https://github.com/nasa/cumulus/compare/v1.22.1...v1.23.2
[v1.22.1]: https://github.com/nasa/cumulus/compare/v1.21.0...v1.22.1
[v1.21.0]: https://github.com/nasa/cumulus/compare/v1.20.0...v1.21.0
[v1.20.0]: https://github.com/nasa/cumulus/compare/v1.19.0...v1.20.0
[v1.19.0]: https://github.com/nasa/cumulus/compare/v1.18.0...v1.19.0
[v1.18.0]: https://github.com/nasa/cumulus/compare/v1.17.0...v1.18.0
[v1.17.0]: https://github.com/nasa/cumulus/compare/v1.16.1...v1.17.0
[v1.16.1]: https://github.com/nasa/cumulus/compare/v1.16.0...v1.16.1
[v1.16.0]: https://github.com/nasa/cumulus/compare/v1.15.0...v1.16.0
[v1.15.0]: https://github.com/nasa/cumulus/compare/v1.14.5...v1.15.0
[v1.14.5]: https://github.com/nasa/cumulus/compare/v1.14.4...v1.14.5
[v1.14.4]: https://github.com/nasa/cumulus/compare/v1.14.3...v1.14.4
[v1.14.3]: https://github.com/nasa/cumulus/compare/v1.14.2...v1.14.3
[v1.14.2]: https://github.com/nasa/cumulus/compare/v1.14.1...v1.14.2
[v1.14.1]: https://github.com/nasa/cumulus/compare/v1.14.0...v1.14.1
[v1.14.0]: https://github.com/nasa/cumulus/compare/v1.13.5...v1.14.0
[v1.13.5]: https://github.com/nasa/cumulus/compare/v1.13.4...v1.13.5
[v1.13.4]: https://github.com/nasa/cumulus/compare/v1.13.3...v1.13.4
[v1.13.3]: https://github.com/nasa/cumulus/compare/v1.13.2...v1.13.3
[v1.13.2]: https://github.com/nasa/cumulus/compare/v1.13.1...v1.13.2
[v1.13.1]: https://github.com/nasa/cumulus/compare/v1.13.0...v1.13.1
[v1.13.0]: https://github.com/nasa/cumulus/compare/v1.12.1...v1.13.0
[v1.12.1]: https://github.com/nasa/cumulus/compare/v1.12.0...v1.12.1
[v1.12.0]: https://github.com/nasa/cumulus/compare/v1.11.3...v1.12.0
[v1.11.3]: https://github.com/nasa/cumulus/compare/v1.11.2...v1.11.3
[v1.11.2]: https://github.com/nasa/cumulus/compare/v1.11.1...v1.11.2
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

[thin-egress-app]: <https://github.com/asfadmin/thin-egress-app> "Thin Egress App"
