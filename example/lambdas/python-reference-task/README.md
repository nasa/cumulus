# @cumulus/python-reference-task

 [`python_reference_workflow`]: https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf

This 'task' is a reference task that is included with Cumulus to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) with a built python lambda.

## Use

Developmental use of this lambda is intended to be simple - the task returns a static processing output, integration tests can be then built against the `Reference Task` step in the [`python_reference_workflow`].

## Development

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library and the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) deployed with Cumulus via the CMA lambda layer ([`cumulus-message-adatper-python`](https://github.com/nasa/cumulus-message-adapter-python) will utilize the layer added to the lambda by default if `CMA_DIR` is set).

The spec test at [`PythonReferenceSpec`](https://github.com/nasa/cumulus/blob/master/example/spec/parallel/pythonReferenceTests/PythonReferenceSpec.js) utilizes this task in combination with the configuration in [`python_reference_workflow`] to validate the tasks run/outputs are as expected for this purpose.

### Requirements

To develop against this task, you should be using python > 3.6 (CMA compatibility is baselined at 3.6).    Once you have a python env enabled:

```bash
pip install -r requirements.txt
```

### Build

```bash
npm run prepare
```

The above command will build the lambda and put a .zip for deployment in ./dist
