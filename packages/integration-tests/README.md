# @cumulus/integration-tests

@cumulus/integration-tests provides a CLI and functions for testing Cumulus.

**Note:** The [documented API](#api) of this package will not change without a
deprecation warning being provided in earlier releases. Code in this package
that is _not_ documented in this README may change without warning, and is not
considered part of the package's public API.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Installation

```sh
$ npm install @cumulus/integration-tests
```

## API

- [Collections](#collections)
- [Executions](#executions)
- [Granules](#granules)

### Collections

```js
const collections = require('@cumulus/integration-test/collections');
```

#### collections.createCollection(prefix, [overrides])

Create a collection using the Cumulus API.

- `prefix` is the name of the Cumulus stack.
- `overrides` is an `Object` that contains values that should override the
  default collection values.
- Returns a `Promise` that resolves to the created collection.

The default collection is very simple. It expects that, for any discovered file,
the granule ID is everything in the filename before the extension. For example,
a file named `gran-1.txt` would have a granuleId of `gran-1`. Filenames can only
contain a single `.` character.

**Collection defaults**

- **name**: random string starting with `collection-name-`
- **version**: random string starting with `collection-version-`
- **reportToEms**: `false`
- **granuleId**: `'^[^.]+$'`
- **granuleIdExtraction**: `'^([^.]+)\..+$'`
- **sampleFileName**: `'asdf.jpg'`
- **files**:
  ```js
  [
    {
      bucket: 'protected',
      regex: '^[^.]+\..+$',
      sampleFileName: 'asdf.jpg'
    }
  ]
  ```

### Executions

```js
const executions = require('@cumulus/integration-test/executions');
```

#### executions.findExecutionArn(prefix, matcher, [options])

Find the execution ARN matching the `matcher` function.

- `prefix` is the name of the Cumulus stack.
- `matcher` is a `Function` that takes an execution argument (as returned by the
  `GET /executions` endpoint) and returns `true` if the execution is the one
  being searched for, and false otherwise.
- `options` is an optional `Object` with one property, `timeout`. This is the
  number of seconds to wait for a matching execution to be found.
- Returns a `Promise` that resolves to the ARN of the matching execution.

#### executions.getCompletedExecution(params)

Wait for an execution status to be `completed` and return the execution.

- `params.prefix` is the name of the Cumulus stack.
- `params.arn` is the execution ARN to fetch.
- `params.callback` is a `Promise`-returning `Function` to invoke the API lambda
  that takes a prefix / user payload. Defaults to
  `cumulusApiClient.invokeApifunction` to invoke the API Lambda.
- `params.timeout`the number of seconds to wait for the execution to reach a
  terminal state. Defaults to 30.
- Returns a `Promise` that resolves to the execution `Object`, as returned by
  the `GET /executions/<execution-arn>` endpoint.

#### executions.getFailedExecution(params)

Wait for an execution status to be `failed` and return the execution.

- `params.prefix` is the name of the Cumulus stack.
- `params.arn` is the execution ARN to fetch.
- `params.callback` is a `Promise`-returning `Function` to invoke the API lambda
  that takes a prefix / user payload. Defaults to
  `cumulusApiClient.invokeApifunction` to invoke the API Lambda.
- `params.timeout`the number of seconds to wait for the execution to reach a
  terminal state. Defaults to 30.
- Returns a `Promise` that resolves to the execution `Object`, as returned by
  the `GET /executions/<execution-arn>` endpoint.

### Granules

```js
const granules = require('@cumulus/integration-test/granules');
```

#### granules.getCompletedGranule(params)

Wait for a granule's status to be `completed` and return the granule.

- `params.prefix` is the name of the Cumulus stack.
- `params.granuleId` is the `granuleId` of the granule
- `params.callback` is a `Promise`-returning `Function` to invoke the API lambda
  that takes a prefix / user payload. Defaults to
  `cumulusApiClient.invokeApifunction` to invoke the API Lambda.
- `params.timeout`the number of seconds to wait for the granule to reach a
  terminal state. Defaults to 30.
- Returns a `Promise` that resolves to a granule `Object`, as returned by the
  `GET /granules/<granule-id>` endpoint.

## CLI Usage

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
