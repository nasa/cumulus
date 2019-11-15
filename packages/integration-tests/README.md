# @cumulus/integration-tests

@cumulus/integration-tests provides a CLI and functions for testing Cumulus workflow executions in a Cumulus deployment.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Installation

```bash
npm install @cumulus/integration-tests
```

## Usage

```bash
Usage: cumulus-test TYPE COMMAND [options]


  Options:

    -V, --version                   output the version number
    -s, --stack-name <stackName>    AWS Cloud Formation stack name (default: null)
    -b, --bucket-name <bucketName>  AWS S3 internal bucket name (default: null)
    -w, --workflow <workflow>       Workflow name (default: null)
    -i, --input-file <inputFile>    Workflow input JSON file (default: null)
    -h, --help                      output usage information


  Commands:

    workflow  Execute a workflow and determine if the workflow completes successfully
```

For example, to test the HelloWorld workflow:

`cumulus-test workflow --stack-name helloworld-cumulus --bucket-name cumulus-bucket-internal --workflow HelloWorldWorkflow --input-file ./helloWorldInput.json`

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
