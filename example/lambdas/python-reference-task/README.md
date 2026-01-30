# @cumulus/python-reference-task

This is a [Cumulus](https://nasa.github.io/cumulus) task that is a reference activity implementation that is included to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) with a built python lambda.

## Use

Developmental use of this lambda is intended to be simple - the task returns a static processing output, integration tests can be then built against the `Reference Task` step in the [`python_reference_workflow`].

## Development

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library and the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) deployed with Cumulus via the CMA lambda layer ([`cumulus-message-adatper-python`](https://github.com/nasa/cumulus-message-adapter-python) will utilize the layer added to the lambda by default if `CMA_DIR` is set).

The spec test at [`PythonReferenceSpec`](https://github.com/nasa/cumulus/blob/master/example/spec/parallel/pythonReferenceTests/PythonReferenceSpec.js) utilizes this task in combination with the configuration in [`python_reference_workflow`] to validate the tasks run/outputs are as expected for this purpose.

### Requirements

To develop against this task, you should be using Python > 3.12 and managed by [uv](https://github.com/astral-sh/uv). See [package.json](package.json), [project.toml](pyproject.toml) for build setup, testing, and packaging. To install dependencies run the following command:

```sh
npm run prepare
```

### Build

```sh
npm run package
```

The above command will build the lambda and put a .zip for deployment in ./dist

### Update

Updates should generally consist of updates to the included [project.toml](pyproject.toml), as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library via [`cumulus-process-py`] dependencies.

### Input

Example input:

```python
{
    {
        "input": {"initialData": "Hello input!"},
        "config": {"configData": "Hello Config!"},
    }
}
```

### Output

Example output:

```python
{
    {
        "inputData": "Hello input!",
        "configInputData": "Hello Config!",
        "newData": {"newKey1": "newData1"},
    }
}
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
