# @cumulus/task-debug

This package provides an executable that can run a workflow defined in a yml file to aid in
development and debugging. The yml file format is the same as the format used for deployments.

The executable parses the yml file to identify the defined workflows and dynamically loads
and executes the tasks for the designated workflow. Output from each task is used to construct
the message payload for the subsequent task. Be advised that although the tasks are running locally,
any calls they make using the AWS SDK (e.g., writing to S3 buckets) will execute in AWS.

This can be run easily in a JS debugger to allow step debugging and examination of internal
state within tasks.

## Usage

```bash
node src/index.js debugg -c <collection-id> -b <s3-bucket> -w <workflow> <config-file>
```

Where

* **collection-id** - ID of the collection defined in the yml config file to use
* **s3-bucket** - S3 bucket to be used as a data-source, e.g., git-private
* **workflow** - Which step function defined in the yml config file to use
* **config-file** - The path to the yml file that defines the configuration for the workflow.
Currently this option is ignored and the file `test-collections.yml` in `packages/common/test/config`
is always used.

## Limitations

* Currently only linear workflows are supported, e.g., no branching, but it should be pretty simple
to add branching support later.
* Because of the dynamic loading of tasks it is recommend to use node 8 without transpiling when
debugging to avoid the need to generate and deal with source maps

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
