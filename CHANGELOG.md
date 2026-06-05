# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **CUMULUS-4891**
  - Add scripts to build Iceberg replication docker images and push them to ECR as part of the build process
- **CUMULUS-4894**
  - Added a test to the db-migration lambda to validate that schemas generated via the bootstrap
    migration and standard migrations are consistent and produce identical database schemas.

### Changed

- **CUMULUS-4882**
  - Updated the triggers on the granules table to track collection updates and introduced a
    `cumulus.allow_collection_update` setting to authorize cross-collection shifts.
  - Modified `@cumulus/api` `granule.updateBatchGranulesCollection` method to use a transaction-scoped
    `SET LOCAL cumulus.allow_collection_update = 'true'` flag to safely authorize bulk collection updates.
  - Optimized `@cumulus/db` `granule.upsert` and `@cumulus/api/lib` `write-granule` to perform
    cross-collection collision checks only on actual unique constraint conflicts during ingest.
  - Updated the `db_partition_config` variable in `tf-modules/data-persistence` to accept null
    values, automatically fall back to defaults, and pass resolved fallback values to the child module.
- **CUMULUS-4918**
  - Add release number to Iceberg APi image if applicable

## [v22.1.1] 2026-05-28

### Added

- **CUMULUS-4912**
  - Move Iceberg API image build from Bamboo to github workflow
- **CUMULUS-4898**
  - Add Iceberg API documentation page to Cumulus Documentation
    Once released, the Iceberg API doc should be at: <https://nasa.github.io/cumulus/docs/next/deployment/iceberg-api>
- **CUMULUS-4866**
  - Add metrics_provider to pg database collection model
  - Add metrics_provider to iceberg schema
  - Add metrics_provider to sns outputs to creation/update/delete executions, granules, pdrs
- **CUMULUS-4866**
  - Add cmrProvider to sns output granules, executions, pdrs
- **CUMULUS-4883**
  - Add script to build Iceberg API docker image and push it to ECR as part of the build process
- **CUMULUS-4705**
  - Add Fargate task to cleanup old Iceberg table snapshots on a schedule
- **CUMULUS-4711**
  - Add integration tests for iceberg API
- **CUMULUS-4664**
  - A single Cumulus deployment can now serve granule data download links across multiple TEA hosts,
    choosing the correct host per granule based on the collection's CMR provider. This makes it possible to
    consolidate several Cumulus deployments into one while preserving the public download URLs that end users
    and CMR records already depend on.
  - Operators configure routing with a new `tea_distribution_url_per_cmr_provider` terraform variable,
    which is a map from CMR provider to TEA base URL. Collections whose CMR provider is not in the map fall
    back to the existing single `tea_distribution_url`, so single-deployment configurations continue to work unchanged.
  - One precondition for consolidating deployments is that every S3 bucket name in the merged bucket map must be globally unique.
- **CUMULUS-4873**
  - Set max_locks_per_transaction database parameter to 256 to support better performance with new partitioning setup.
- **CUMULUS-4873**
  - Add initial module for BigNBit.

### Changed

- **CUMULUS-4694** Change replication tasks to use proper region
- **CUMULUS-4891** Force build/push of iceberg replication images when merging to master
- **CUMULUS-4776** Split iceberg replication into separate services and add support for partitioned tables
- **async-operations-update**
  - Update Async Operation container to new version 57, `cumuluss/async-operation:57`. Users should update their references to `async-operation` with the new version.

## [v22.0.0] 2026-05-12

### Breaking Changes

- **CUMULUS-4780**
  - Database Partitioning: The database schema has been rebuilt using a partitioned structure.
  - Incompatibility: Because the table structures have fundamentally changed, existing databases
    cannot be updated. A fresh database is required.

### Added

- **CUMULUS-4829**
  - Add background job to refresh stale DuckDB connections for iceberg API
- **CUMULUS-4815**
  - Add support for file-related searches to go to the files_table in iceberg
- **CUMULUS-4709**
  - Fix stale connections problem in iceberg API
- **CUMULUS-4710**
  - Implement list of stats route in iceberg search api
  - Add warming up of duckdb connections
- **CUMULUS-4708**
  - Implement list of executions route in iceberg search api
- **CUMULUS-4707**
  - Implement list of granules route in iceberg search api
- **CUMULUS-4534**
  - collection db model has added non-optional cmr_provider field
  - update requires db-migration to add cmr_provider to collection model
- **CUMULUS-4706**
  - Define and serve the iceberg search api routes through the iceberg api server.
- **CUMULUS-4606**
  - Add terraform module and example deployment for RDS to Iceberg replication Fargate cluster
    and associated service/task.
- **CUMULUS-4558**
  - Added provisioning ECS Fargate infrastructure for cumulus api using terraform.
- **CUMULUS-4557**
  - Make a containerized iceberg api that can be deployed to ECS.
- **async-operations-update**
  - Update Async Operation container to new version 56, `cumuluss/async-operation:56`. Users should update their references to `async-operation` with the new version.
- **CUMULUS-4780**
  - Implemented partitioned schema for the consolidated database tables.
- **CUMULUS-4804**
  - Updated application logic to ensure compatibility with partitioned database schemas.
- **CUMULUS-4839**
  - Updated `@cumulus/db/search` `GranuleSearch` query builder to prepend the partition key
    `collection_cumulus_id` to sort orders when collection filters are present.

### Changed

- **CUMULUS-4789** Update Docusaurus to latest version - 3.10

- **CSD-104**
  - `PVLNumeric` now stores the original string value as `rawValue` before converting to `Number()`, preserving precision for large numeric strings.
  - Fixed `PDRParsingError` when a PDR contains an MD5 `FILE_CKSUM_VALUE` that is an unquoted all-decimal string (e.g. `73806951753129206387143405718909`). The PVL parser previously classified such values as numeric, causing precision loss via JavaScript's `Number()` conversion. The original string is now preserved via `PVLNumeric.rawValue` and used for MD5 checksum validation.
  - MD5 checksum values are now validated as 32-character hex strings, providing a clearer error message for values that are not valid MD5 hashes.

- **CUMULUS-4576** Upgrade Cumulus to use the latest version of TEA (3.0.0)
  ** UPGRADE NOTE: When upgrading the TEA module version, use a two-phase apply to prevent rollback failures
  caused by Terraform destroying old lambda S3 objects before the CloudFormation stack update completes.

  #### Migration Notes

  All core tasks that enqueue messages to launch workflows are updated to use collection defined cmrProvider. Any daac/consolidation tasks which perform the same function need to ensure they do the same.

  Phase 1 — upload new S3 objects and update CF stack (keeps old S3 objects intact as rollback targets if the CF update fails):

   ````bash
   terraform apply \
     -target=module.thin_egress_app.aws_s3_object.cloudformation_template \
     -target=module.thin_egress_app.aws_s3_object.lambda_source \
     -target=module.thin_egress_app.aws_s3_object.lambda_code_dependency_archive \
     -target=module.thin_egress_app.aws_s3_bucket.lambda_source \
     -target=module.thin_egress_app.aws_cloudformation_stack.thin_egress_app \
     -var-file=env/sandbox.tfvars
   ````

  Phase 2 — full apply to clean up old S3 objects and apply remaining changes:

  ````bash
  terraform apply -var-file=env/sandbox.tfvars
  ````

- **CUMULUS-4788**
  - split replication service into multiple services, one for each replication table group
- **CUMULUS-4534**
  - collection translate functions pass cmr_provider/cmrProvider back and forth
  - sf-scheduler lambda function uses collection cmr_provider to fill provider in cmr section of message template meta
  - enqueueParsePdrMessage, enqueueGranuleIngestMessage, enqueueWorkflowMessage also use collection cmr_provider to fill provider in cmr section of message template meta
  - enqueueWorkflowMessage (used in queue-workflow task) uses collection cmr_provider to fill provider in cmr section of message template meta
  - enqueueParsePdrMessage (used in queue-pdrs task) uses collection cmr_provider to fill provider in cmr section of message template meta
  - enqueueGranuleIngestMessage (used in queue-granules task) uses collection cmr_provider to fill provider in cmr section of message template meta
- **CUMULUS-4567**
  - Add SQL and TypeScript migration files to alter the executions_cumulus_id sequence type.

### Fixed

- **Security Vulnerabilities**
  - Upgraded package `lodash` to version 4.18.1.
  - Updated package overrides to address CVEs GHSA-43fc-jf86-j433 and GHSA-r5fr-rjxr-66jc.
  - added a `webpack` override to `/website/package.json` due to docusaurus conflicts
  - Upgraded package `uuid` to version ^11.1.1.
  - Upgraded package `tmp` to address <https://github.com/advisories/GHSA-ph9p-34f9-6g65>
- **CSD-100**
  - made changes to the `PrivateApiLambda` and `ApiEndpoints` lambdas to ensure the environment variables
    are loaded after the handler invocation to circumvent `InvalidSignatureException` errors that were being reported
- **CUMULUS-4606**
  - Added prefix to IAM resource names to prevent collisions from multiple deployments in sandbox environment
- **CUMULUS-4844**
  - Fixed `@cumulus/db` `BaseSearch.shouldEstimateRowcount()` to compare against SQL generated
    by `baseCountQuery()` instead of a hardcoded query string, ensuring accurate detection of table count queries.
- **CUMULUS-4874**
  - Fixed `@cumulus/api` `endpoints/rules/patchRule` to delete old Kinesis and SNS resources prior
    to allocating new resources.
  - Refactored `@cumulus/api` `addSnsTrigger` to verify active Lambda permissions before adding permission.
  - Updated snsRuleSpec.js integration test to verify that the updated rule with an existing
    subscription topic correctly triggers workflows.
  - Updated `packages/test-data` .nc mock granule files to match the checksums defined in their
    signal validation files.

## [v21.3.5] 2026-06-02

Please note changes in 21.3.5 may not yet be released in future versions, as this is a backport and patch release on the 21.3.x series of releases. Updates that are included in the future will have a corresponding CHANGELOG entry in future releases..

### Changed

- **CSD-99**
  - Changed the `CMR` class to a singleton
  - Changed `cmr-utils` functions that call the `CMR` class functions to retry upon 401 authentication failures
  - Added functions `checkRefreshLaunchpadToken` and `refreshLaunchpadToken` to the `CMR` class to be invoked upon a 401 authentication failure which removes and/or retrieves a valid launchpad token
  - Added functions to the `launchpad-auth` package which adds a lock file for token creation, removes an invalid token, and checks s3 for the token and lock file

### Fixed

- **CUMULUS-4874**
  - Fixed `@cumulus/api` `endpoints/rules/patchRule` to delete old Kinesis and SNS resources prior
    to allocating new resources.
  - Refactored `@cumulus/api` `addSnsTrigger` to verify active Lambda permissions before adding permission.
  - Updated snsRuleSpec.js integration test to verify that the updated rule with an existing
    subscription topic correctly triggers workflows.
  - Updated `packages/test-data` .nc mock granule files to match the checksums defined in their
    signal validation files.

## [v21.3.4] 2026-05-12

Please note changes in 21.3.4 may not yet be released in future versions, as this is a backport and patch release on the 21.3.x series of releases. Updates that are included in the future will have a corresponding CHANGELOG entry in future releases..

- **CSD-102**
  - Refactored `aws_s3_bucket_lifecycle_configuration` to support user-defined rules via Terraform variables.
  - Included configuration examples for `aws_s3_bucket_lifecycle_configuration` in the [documentation](https://nasa.github.io/cumulus/docs/configuration/lifecycle-policies).
- **CSD-104**
  - `PVLNumeric` now stores the original string value as `rawValue` before converting to `Number()`, preserving precision for large numeric strings.
  - Fixed `PDRParsingError` when a PDR contains an MD5 `FILE_CKSUM_VALUE` that is an unquoted all-decimal string (e.g. `73806951753129206387143405718909`). The PVL parser previously classified such values as numeric, causing precision loss via JavaScript's `Number()` conversion. The original string is now preserved via `PVLNumeric.rawValue` and used for MD5 checksum validation.
  - MD5 checksum values are now validated as 32-character hex strings, providing a clearer error message for values that are not valid MD5 hashes.
- **CUMULUS-4566**
  - Added logging for failed granules with granules writes vs just having an aggregate error, for better tracking of failures
- **CUMULUS-4789**
  - Update Docusaurus to latest version - 3.10
- **async-operations-update**
  - Updated Async Operation container to new version 57, `cumuluss/async-operation:57`. Users should update their references to `async-operation` with the new version.

### Fixed

- **Security Vulnerabilities**
  - Upgraded package `uuid` to version ^11.1.1.
- **CUMULUS-4844**
  - Fixed `@cumulus/db` `BaseSearch.shouldEstimateRowcount()` to compare against SQL generated
    by `baseCountQuery()` instead of a hardcoded query string, ensuring accurate detection of table count queries.

## [v21.3.3] 2026-04-10

- Upgraded package `lodash` to version 4.18.1.

- **CUMULUS-4576** Upgrade Cumulus to use the latest version of TEA (3.0.0)
  ** UPGRADE NOTE: When upgrading the TEA module version, use a two-phase apply to prevent rollback failures
  caused by Terraform destroying old lambda S3 objects before the CloudFormation stack update completes.

 Phase 1 — upload new S3 objects and update CF stack (keeps old S3 objects intact as rollback targets if the CF update fails):

   ````terraform apply \
     -target=module.thin_egress_app.aws_s3_object.cloudformation_template \
     -target=module.thin_egress_app.aws_s3_object.lambda_source \
     -target=module.thin_egress_app.aws_s3_object.lambda_code_dependency_archive \
     -target=module.thin_egress_app.aws_s3_bucket.lambda_source \
     -target=module.thin_egress_app.aws_cloudformation_stack.thin_egress_app \
     -var-file=env/sandbox.tfvars
   ````

 Phase 2 — full apply to clean up old S3 objects and apply remaining changes:
````terraform apply -var-file=env/sandbox.tfvars````

### Changed

- **CSD-100**
  - made changes to the `PrivateApiLambda` and `ApiEndpoints` lambdas to ensure the environment variables
    are loaded after the handler invocation to circumvent `InvalidSignatureException` errors that were being reported
- **CUMULUS-4567**
  - Add SQL and TypeScript migration files to alter the executions_cumulus_id sequence type.

## [v21.3.2] 2026-03-20

### Migration Notes

- **CUMULUS-4395 Core CnmResponse task lambda log group import**
  - The lambda function name and log group name for this task are
  `<prefix>-CnmResponse` which might conflict with the non-core version of
  the task if you set that up in your terraform. In order to successfully deploy
  the core task you may need to either:
    - Delete the existing lambda and log group or
    - Import the existing lambda and/or log group to allow terraform to modify
    them.

    ```bash
    terraform import module.cumulus.module.ingest.module.cnm_response_task.aws_cloudwatch_log_group.cnm_response_task /aws/lambda/<prefix>-CnmResponse
    terraform import module.cumulus.module.ingest.module.cnm_response_task.aws_lambda_function.cnm_response_task arn:aws:lambda:us-east-1:<account-number>:function:<prefix>-CnmResponse
    ```

    **NOTE: For cumulus core developer ci stacks you only need to import the log
    group, since the lambda deployed in the example/cumulus-tf directory will be
    renamed automatically.**

### Notable Changes

- **CSD-85**
  - Changed `update-granules-cmr-metadata-file-links` task config to accept a variable `excludeDataGranule`
    for whether or not to add or update a `Granule.DataGranule` to the granule's metadata, for users who do not want one added or updated from what their granule metadata already is (defaults to `false`). See [update-granules-cmr-metadata-file-links](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links#readme) for more details.

- **CSD-91**
  - Added a task config var to update-granules-cmr-metadata-file-links `updateGranuleIdentifiers` for whether or not to update the Granule metadata's identifiers and `GranuleUR`, defaults to true. See [update-granules-cmr-metadata-file-links](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links#readme) for more details.

### Breaking Changes

- **CUMULUS-4107**
  - Changed "_doc" type to "undefined" for ElasticSearch v8.x query parameter . The ES client will omit undefined values from the request. This doesn't touch the other callers.
- **CUMULUS-4473**
  - Updated Granules Bulk Operations API endpoints to accept a list of granuleIds instead of
    granule objects in the payload.
  - Updated `/executions/search-by-granules` and `/executions/workflows-by-granules` endpoints
    to accept granuleIds instead of granule objects in the payload.

### Added

- **CUMULUS-4564**
  - Added private_api_lambda_arn as an output in the Cumulus terraform module

- **CUMULUS-4473**
  - Updated Granules Bulk Operations API endpoints to support `granuleInventoryReportName` and
    `s3GranuleIdInputFile` in the payload. `batchSize` added as an optional parameter for
    processing granules from the file options.
- **CUMULUS-4388**
  - Added cnm_to_cma task (lambda).
  - Original cnm_to_cma was written in Java.  Converted to Python.
- **CUMULUS-4382**
  - Migrated the granule-invalidator task to the `tasks` directory as part of a coreification task in support of providing rolling archive functionality.
- **CUMULUS-4385**
  - Added supporting Terraform for the granule-invalidator task that allows it to be included in the Cumulus terraform zipfile and deployed with Cumulus.
  - Hard-coded values for architecture and python version which will later be dynamically referenced by a top-level build config.
- **CUMULUS-4394**
  - Added python code for CnmResponse task adapted from <https://github.com/podaac/cumulus-cnm-response-task>
- **CUMULUS-4395**
  - Added supporting Terraform for the CnmResponse task that allows it to be included in the Cumulus terraform zipfile and deployed with Cumulus.
- **CUMULUS-4352**
  - Implemented multi-part download support for checksum computation in addMissingFileChecksums task.
- **CUMULUS-4542**
  - Created the `aws-api-proxy` coreified task, which provides the functionality to post a list of CNM messages to a specified SNS topic.
- **CUMULUS-4517**
  - Added the `@cumulus/db/s3search` module to enable Cumulus record search via S3-backed tables.
    The S3Search subclasses inherit from search/BaseSearch, allowing them to reuse existing query
    logic while executing search queries on DuckDB and providing custom record translation.
  - Updated the `@cumulus/db/search` module to build queries compatible with both PostgreSQL and DuckDB.
  - Updated the `@cumulus/db/search` module to support searching on nested JSON fields.
  - Updated the `@cumulus/db/translate` `translatePostgres*Record*ToApi*Record*` functions to
    correctly handle query results from both PostgreSQL and DuckDB.
- **CUMULUS-4543**
  - Added supporting Terraform for the aws_api_proxy task
  - Added aws_api_proxy output to the Cumulus Terraform module
- **CUMULUS-4544**
  - Added integration tests for the aws_api_proxy task
- **CUMULUS-4545**
  - Created integration tests for get_cnm task
- **CUMULUS-4546**
  - Created IaC needed to support get_cnm task
- **CUMULUS-4547**
  - Added get_cnm task to tasks directory
- **CUMULUS-4400**
  - Added integration testing for CnmResponse task.
  - Updated example workflows to include the exception message in the
  `WorkflowFailed` state.
- **CUMULUS-4427**
  - Added pdr-cleanup task into cumulus core from ASDC
- **CUMULUS-4563**
  - Added a Github action to generate requirements.txt files from coreified uv.lock files

### Changed

- **CUMULUS-4473**
  - Updated Granules Bulk Operations return consistent output formats across different bulk opertions
    (previously, some bulk operation aggregated errors while others returned per-granule errors)
  - Removed the `getUniqueGranuleByGranuleId` and `getGranuleByUniqueColumns` functions from the
    `@cumulus/db` package, since a single granule record can be retrieved using a unique `granule_id`.
- **CUMULUS-4384**
  - Added granule-invalidator workflow deployment and tests to the example deployment.
  - Resolved several integration issues with the granule-invalidator lambda.
  - Updated packaging script for granule-invalidator to use `uv pip install` instead of `uv sync`.
  - Added `private_api_lambda_arn` output to the archive module and `private_api_lambda_arn` variable to the ingest module.
- **CUMULUS-4472**
  - added `concurrency` utilization by `pMap` for granule `bulkOperations` `applyWorkflowToGranule`, which previously was missing
  - allow `concurrency` and `maxDbConnections` to be passed into granule `bulkOperations` and `bulkReingest` endpoints, which previously was only available for `bulkDelete`
  - updated enforcement of granule bulk operations endpoints to accept exactly one of `granules, query, granuleInventoryReportName, or s3GranuleIdInputFile`
- **CSD-85**
  - Changed `update-granules-cmr-metadata-file-links` task config to accept a variable `excludeDataGranule`
    for whether or not to add or update a `Granule.DataGranule` to the granule's metadata, for users who do not want one added or updated from what their granule metadata already is (defaults to `false`). See [update-granules-cmr-metadata-file-links](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links#readme) for more details.
- **CUMULUS-4570**
  - Update corified tasks to use the common cumulus-task module
  - Rename tasks to use PascalCase and update casing of acronyms to match existing core tasks

    | old | new
    | --- | ---
    | aws-api-proxy | AwsApiProxy
    | CNMToCMA | CnmToCma
    | granule-invalidator-task | GranuleInvalidator

- **CUMULUS-4599**
  - Added the ability to easily modify version numbers for all python packages in order to keep them in sync with the Cumulus version.
- **CUMULUS-4562**
  - Upgraded lerna to v9.
  - Updated monorepo configuration and root package.json to align with Lerna v9.
  - Removed prepare scripts from all package-level package.json files to prevent unintended lifecycle execution during install.
  - Updated CI (Docker + Bamboo) to ensure compatibility with the new Lerna version.
  - Applied necessary dependency and script adjustments across affected packages.
  - Updated the markdownlint-cli package and fixed linting errors or disabled specific rules.
  - Fixed security vulnerabilities related to minimatch, uuid, fast-xml-parser packages etc.
  - Replaced legacy querystring module with URLSearchParams.
- **CSD-91**
  - Added a task config var to update-granules-cmr-metadata-file-links `updateGranuleIdentifiers` for whether or not to update the Granule metadata's identifiers and `GranuleUR`, defaults to true. See [update-granules-cmr-metadata-file-links](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links#readme) for more details.

### Fixed

- **CUMULUS-4564**
  - hotfix for a terraform deployment issue found in the granule invalidator workflow causing the PrivateApiLambda to not be recreated
- **CUMULUS-4516**
  - Updated sftp-client to explicitly tear down stream in sftp-client/syncFromS3
  - Updated sftp-client to warn/log on `No response from server` errors in `end` method
- **CUMULUS-4608**
  - Fixed bug where workflow list endpoint /workflows would error if a workflow field was undefined.   The API response now returns null for undefined fields and the sort method converts the value to string before sorting.
- **CUMULUS-4566**
  - Updated AJV to ^8.18.0
    - Updated task components to resolve malformed/errant task schemas in the following lambdas:
      - SyncGranules
      - SendPan
      - QueueGranules
      - MoveGranules
      - LzardsBackup
      - ChangeGranuleCollectionS3
  - Update aws-sdk versions to ^3.993.0

## [v21.3.1] 2026-02-16

### Added

- **CUMULUS-4498**
  - Added `states:StartExecution` action to the `<prefix>-steprole` IAM role.

### Changed

- **CUMULUS-4514**
  - Pinned fast-xml-parser at 5.3.4 for @aws-sdk/xml-builder due to a security vulnerability.

## [v21.3.0] 2026-01-26

### Migration Notes

Please complete the following steps before upgrading Cumulus.

- **CUMULUS-4459 New index added to the granules table to improve Dashboard performance**
  - The fix introduced in CUMULUS-4459 requires a manual database update in the production environment.
  This step ensures the new index is created successfully, even in the unlikely event that the database-migration
  Lambda function did not complete the index creation before timing out.

  Please follow the standard procedures for running a production database migration, and execute the following SQL to create the index:

  ```text
  CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_collection_updated_idx ON granules (collection_cumulus_id, updated_at);
  ```

- **CUMULUS-4313**
  - Update Async Operation container to new version 55, `cumuluss/async-operation:55`. Users should update their references to `async-operation` with the new version.
  - Updated lerna dev-dependency to v8
  - Added CI shim script to allow `lerna publish` to work with tar pinned to `^7.5.3`

### Notable Changes

- **CUMULUS-4459**
  - Added new index to the granules table to improve Dashboard performance.
- **CUMULUS-4446**
  - Updated all node lambdas/Core build environments to utilize node v22.
  - Updated cma-js dependency to 2.4.0
- **CUMULUS-3574**
  - Granule file writes are now atomic. Previously, some granule files could be written even if others failed;
    now, if any granule file fails, none are written.
- **CUMULUS-4087**
  - Updated /refresh token endpoint and other functions to support automatic extension of cumulus dashboard user sessions by using iat claims and extending token expiration time. `MAX_SESSION_DURATION` environment variable defaults to 12 hours but can be overriden.
- **CUMULUS-4272**
  - The `tf-modules/cumulus-rds-tf` module now allows specifying an existing security group.
    This enhancement enables DAACs to migrate their existing RDS deployments to Aurora while
    reusing their existing security group, ensuring compatibility with existing
    `data-persistence-tf` and `cumulus-tf` modules.

### Added

- **CUMULUS-4300**
  - Added a new rate-limited consumer class in the Node/TypeScript code to control how many executions are submitted per second across multiple queues - helping improve and smooth out step function submission.
    - Created a new ConsumerRateLimited class that is able to submit executions at a specified, even maximum rate as defined by rateLimitPerSecond. In order to enforce this limit across all throttled queues, this class accepts a list of queue URLs instead of a single throttled queue URL. Unlike its non-rate-limited counterpart, to simplify configuration, this new class does not limit the number of messages staged - that can now be indirectly controlled by increasing or decreasing the rate.
    - Added calls to the new ConsumerRateLimited class in sf-starter.js in the handleRateLimitedEvent function. This uses the incrementAndDispatch dispatcher.
    - Added a new Lambda named "sqs2sfThrottleRateLimited" that can be called with a list of queueURLs in an EventBridge scheduled rule.
    - Added sqs2sfThrottleRateLimited_lambda_function_arn outputs to both ingest and cumulus modules.
- **CUMULUS-4411**
  - The `tf-modules/cumulus-rds-tf` module now supports enabling RDS slow query logging in CloudWatch.
    By setting `db_log_min_duration_ms` to a positive value (in milliseconds) and `enabled_cloudwatch_logs_exports`
    to `["postgresql"]`, RDS will log and export any database queries that take longer than that threshold.
    The module also configures the required RDS extensions and parameters necessary for slow query instrumentation.

### Changed

- **CSD-82**
  - Updated `/workflows/list` endpoint to accept `countOnly`, `prefix`, `infix`, `fields`, `limit`, and `order` query string params
- **CUMULUS-4374**
  - Updated example python Lambdas to utilize `uv` as their package manager. This change removes references to
    pipenv. Developers should migrate to using `uv` to manage python dependencies and virtual envs which may
    require reinstalling python libraries. This change also updates the names of the example python task services
    because of a deployment race condition. These services are only used for integration tests.
- **CUMULUS-4387**
  - Updated linting scripts to include `ruff` and `mypy` and enable lint rules in repo level
  `pyproject.toml` file.
- **CUMULUS-4406**
  - Changed the `limit` variable inside the pdr-status-check task from an input variable to a config variable
- **CUMULUS-4430**
  - Updated GitHub Actions to run `ruff` linting on PRs.
  - Updated GitHub Actions to run `eslint`, `markdownlint`, and `npm-package-json-lint` on PRs.
- **CUMULUS-4433**
  - Adds pre-commit config and hooks to the repository. Developers are encouraged to install pre-commit and read
  the [pre-commit setup docs](./docs/development/pre-commit-setup.md) to ensure they have the correct setup.
- **CUMULUS-4438**
  - Made `min_capacity` and `max_capacity` configurable in example/rds-cluster-tf
  - Made `archive_api_users` configurable in example/cumulus-tf
- **CSD-61**
  - Updated writeGranuleFromApi() endpoint to allow createdAt and updatedAt fields to be null.
- **CUMULUS-4436**
  - Created new documentation files for language best practices `docs/development/python-best-practices.md` and `docs/development/typescript-best-practices.md`.
  - Updated documentation file `docs/development/quality-and-coverage.md` to be more repo wide and reference language best practices.
  - Updated `docs/adding-a-task.md` to include instructions and expectations when adding a task.
- **OTHER**
  - Corrected misspelling in README.md related to installing `uv`.
  - Added override for `tar` in package.json.

### Fixed

- **CUMULUS-4486**
  - Fixed a small bug with `rulesHelpers` in which `rule.rule.meta.allowProviderMismatchOnRuleFilter` was erroring due to
    database validation errors to instead refer to `rule.meta.allowProviderMismatchOnRuleFilter`
  - Added `allowProviderMismatchOnRuleFilter` to the `meta` field of `rules` in `/api/lib/schemas`s
- **CUMULUS-4458**
  - Fixed a small bug with `message_consumer` lambda env and function variable names to match so the lambda env var `allowProviderMismatchOnRuleFilter` can be properly used when set

## CHANGELOG Archival

As of version 21.3.x the CHANGELOG has been truncated.     For history prior to the release v22 series, please refer to the CHANGELOG referred to in the last Legacy Cumulus release: [CHANGELOG.md](https://github.com/nasa/cumulus/blob/v21.3.5/CHANGELOG.md)

[Unreleased]: https://github.com/nasa/cumulus/compare/v22.1.1...HEAD
[v22.1.1]: https://github.com/nasa/cumulus/compare/v22.0.0...v22.1.1
[v22.0.0]: https://github.com/nasa/cumulus/compare/v21.3.5...v22.0.0
