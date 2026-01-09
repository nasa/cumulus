# @cumulus/python-reference-activity

This is a [Cumulus](https://nasa.github.io/cumulus) task that is a reference activity implementation that is included to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) and [`cumulus-process-py`](https://github.com/nasa/cumulus-process-py) with a deployed activity.

## Development

Developmental use of this lambda is intended to be simple - the processing activity runs an activity through the CMA and returns a static processing output, integration tests can then be built against the `Reference Activity` step in the [`python_reference_workflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf).

### Requirements

To develop against this task, you should be using Python > 3.12 and managed by [uv](https://github.com/astral-sh/uv). See [package.json](package.json), [project.toml](pyproject.toml) for build setup, testing, and packaging.

```sh
npm run prepare
```

### Build

To update the container for a PR, you should run:

```sh
npm run package
```

By default package will tag the container as `latest`. You can pass an optional argument to `package` if you want a specific version. For example:

```sh
npm run package -- 1.2.3
```

Then push to the configured ECR following the AWS console instructions for pushing to ECR for use in your build.

Then update the `python_processing_service` resource in [`python_reference_workflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) to utilize the correct image reference.

***Note*** the activity will *not* automatically include the CMA in the same way [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) does, as this module has not been similarly developed to pull down a deployed lambda and its layers. The current workflow for integrating the CMA with python activities is for users to create an image *per* activity, where the CMA is brought is as a dependency of [`cumulus-process-py`] or the module itself, and deploy that instead.

### Test

Tests can be found in the [tests/](tests/) directory and the preferred test framework is [pytest](https://docs.pytest.org/en/stable/). Tests can be executed with the following commands:

```sh
npm run test
```

### Update

Updates should generally consist of updates to the included [project.toml](pyproject.toml), as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library via [`cumulus-process-py`] dependencies.

### Input

Example input:

```python
{
    "granules": [
        {
            "files": [
                {
                    "bucket": "test-bucket",
                    "key": "test_data_file.hdf",
                    "type": "data",
                }
            ]
        }
    ]
}
```

### Output

Example output:

```python
{
    "fake_output1": "first fake output",
    "fake_output2": "second fake output",
}
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
