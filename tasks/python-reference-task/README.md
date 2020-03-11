# @cumulus/python-reference-task

This 'task' is a reference task that is included with core to allow integration testing of the `cumulus message adapter` with a build python lambda.

## Use

Developmental use of this lambda is intended to be simple - the task returns a static processing output, integration tests can be then built against the `Refernce Task` step in the `PythonProcess` workflow.

## Development

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [cumulus-message-adapter-python](https://github.com/nasa/cumulus-message-adapter-python) client library and the [cumulus-message-adapter](https://github.com/nasa/cumulus-message-adapter) deployed with Cumulus via the CMA lambda layer (cma-py will utilize the layer added to the lambda by default if `CMA_DIR` is set).

The spec test at [PythonReferenceASpec](https://github.com/nasa/cumulus/blob/master/example/spec/parallel/pythonReferenceTests/PythonReferenceSpec.js) utilizes this task in combination with the configuration in [python_reference_workflow.tf](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) to validate the tasks run/outputs are as expected for this purpose.

### Requirements

To develop against this task, you should be using python > 3.6 (CMA compatibility is baselined at 3.6).    Once you have a python env enabled:

```bash
pip install -r requirements.txt
```

### Build

```bash
npm run prepare
```

will build the lambda and put a .zip for deployment in ./dist

### Test

