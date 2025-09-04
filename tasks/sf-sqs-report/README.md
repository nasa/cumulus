# @cumulus/sf-sqs-report

Broadcast an incoming Cumulus message to SQS.  This lambda function works with Cumulus Message Adapter, and it can be used anywhere in a step function workflow to report execution, granule and PDR status.

Note that the initial and final reporting of an execution/granule/PDR status is now handled by Cumulus outside of the workflow process, so the use of this task to report start/stop status is unsupported. **This task should only be utilized if an update to status mid-workflow is desired.**

If the task's input includes a `payload` key, the value of the key is returned as the output of the task, otherwise the output will be an empty object.

The task sets `meta.reportMessageSource` in the Cumulus message, so lambdas such as `sfEventSqsToDbRecords` know where the Cumulus message is coming from.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
