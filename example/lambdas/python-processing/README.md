# @cumulus/python-processing

[`python_processing_workflow`]: https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_processing_workflow.tf
[`cumulus-process-py`]: https://github.com/nasa/cumulus-process-py

This 'task' is a reference activity implementation that is included with Cumulus to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) and [`cumulus-process-py`] with a deployed activity.

## Development

This lambda is intended to be simple - the processing activity takes the input of a typical MOD09GQ.006 s3 ingest workflow output from the SyncGranules task, creates and uploads a simple `.md5` hashfile and returns it with the expected output filelist for `FilesToGranules` to complete the workflow via the `MoveGranules` task.

### Requirements

To develop against this task, you should be using python > 3.6 (CMA compatibility is baselined at 3.6).    Once you have a python env enabled:

```bash
pip install -r requirements.txt
```

### Build

To update the container for a PR, you should run:

```bash
docker build -t cumuluss/test-python-ingest-processing:{VERSION} .
docker push cumuluss/test-python-ingest-processing:{VERSION}
```

Then update the `python_processing_service` resource in [`python_reference_workflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) to utilize the correct image reference.

***Note*** the activity will *not* automatically include the CMA in the same way [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) does, as this module has not been similarly developed to pull down a deployed lambda and its layers. The current workflow for integrating the CMA with python activities is for users to create an image *per* activity, where the CMA is brought is as a dependency of [`cumulus-process-py`] or the module itself, and deploy that instead.

## Updates

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library via [`cumulus-process-py`] dependencies.
