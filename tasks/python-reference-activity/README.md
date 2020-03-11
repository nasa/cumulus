# @cumulus/python-reference-activity

This 'task' is a reference activity implementation that is included with core to allow integration testing of the `cumulus message adapter` and `cumulus-process-py` with a deployed activity.

## Development

Developmental use of this lambda is intended to be simple - the processing activity runs an activity through the CMA and returns a static processing output, integration tests can be then built against the `Refernce Activity` step in the `PythonProcess` workflow in combination with the `Reference Task`step.

### Requirements

To develop against this task, you should be using python > 3.6 (CMA compatibility is baselined at 3.6).    Once you have a python env enabled:

```bash
pip install -r requirements.txt
```

### Build

To update the container for a PR, you should run:

```bash
docker build -t cumuluss/cumulus-process-activity:{VERSION} .
docker push cumuluss/cumulus-process-activity:{VERSION}
```

Then update [`python_reference_workflow.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) `python_processing_service` resource to utilize the correct image reference.

***Note*** the activity will *not* make use of the CMA lambda layer in the same way `cumulus-ecs-task` does, as this module has not been similarly developed to pull down a deployed lambda and it's layers.    The current workflow is for users to create an image *per* task similar to this reference implementation and deploy that instead.

## Updates

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [cumulus-message-adapter-python](https://github.com/nasa/cumulus-message-adapter-python) client library via [cumulus-process-py](https://github.com/nasa/cumulus-process-py) dependencies.

