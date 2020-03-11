from run_cumulus_task import run_cumulus_task


def task(event, context):
    return {"inputData": event['input']['initialData'],
            "configInputData": event['config']['configData'],
            "newData": {"newKey1": "newData1"}}


def handler(event, context):
    return run_cumulus_task(task, event, context)

if __name__ == "__main__":
    result = handler({
        "cma": {
            "event": {
                "cumulus_meta": {
                    "message_source": "local",
                    "task": "Test Task",
                    "system_bucket": "cumulus-test-sandbox-internal"
                },
                "meta": {
                    "provider": "some value",
                    "stack": "test stack"
                },
                "task_config": {
                    "provider": "{$.meta.provider}",
                    "stack": "{$.meta.stack}",
                    "cumulus_message": {
                        "outputs": [
                            {
                                "source": "{$.example}",
                                "destination": "{$.payload}"
                            }
                        ]
                    }
                },
                "ReplaceConfig": {
                    "MaxSize": 1,
                    "Path": "$.payload",
                    "TargetPath": "$.payload"
                }
            }}}, {})
    print(result)
