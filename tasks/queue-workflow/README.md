# @cumulus/queue-workflow

This lambda function adds a workflow to a queue

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| internalBucket | string | (required) | S3 bucket
| parentWorkflow | string | (required) | Parent workflow of the task
| stackName | string | (required) | Name of deployment stack
| queueUrl | string | (required) | SQS queue url
| executionNamePrefix | string | (optional) | the prefix to apply to the name of the enqueued execution

### Input

Input object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| workflow | object | (required) | The workflow to be queued
| workflowInput | object | (required) | The payload to the workflow to be executed
| queueUrl | string | (optional) |  URL to an SQS queue (e.g. to specify a lower priority queue)

### Output

Output object fields:

| field name | type | default | values | description
| ---------- | ---- | ------- | ------ | -----------
| workflow | object | N/A | The workflow to be queued
| workflowInput | object | N/A | The payload to the workflow to be executed
| running | string | N/A | The execution arn for queuing the workflow

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
