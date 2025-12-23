"""Python reference task implementation that takes a test task input and adds
some values to the payloads for use with PythonReferenceSpec.js.
"""

from run_cumulus_task import run_cumulus_task


def task(event, _context):
    """Task takes an event and returns it with test values added."""
    return {
        "inputData": event["input"]["initialData"],
        "configInputData": event["config"]["configData"],
        "newData": {"newKey1": "newData1"},
    }


def handler(event, _context):
    """Lambda handler.

    Run the task through the CMA `run_cumulus_task` method.
    """
    return run_cumulus_task(task, event, _context)
