# @cumulus/python-reference-task

This 'task' is a reference task that is included with core to allow integration testing of the `cumulus message adapter` with a build python lambda.

## Use

Developmental use of this lambda is intended to be simple - the task returns a static processing output, integration tests can be then built against the `Refernce Task` step in the `PythonProcess` workflow.

## Development

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [cumulus-message-adapter-python](https://github.com/nasa/cumulus-message-adapter-python) client library and the [cumulus-message-adapter](https://github.com/nasa/cumulus-message-adapter) deployed with Cumulus via the CMA lambda layer (cma-py will utilize the layer added to the lambda by default if `CMA_DIR` is set).

### Build

To build this task, you should be using python 3.6 or 3.7 (CMA compatibility is through python 3.6), however any python > 3.6 should work.    Once you have a python env enabled:

```bash
npm run prepare
```

will build the lambda and put a .zip for deployment in ./dist

### Test

TBD