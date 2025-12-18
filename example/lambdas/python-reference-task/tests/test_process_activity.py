import initial_task


def test_process():
    input = {
        "input": [{"initialData": "Hello input!"}],
        "config": {"configData": "Hello Config!"},
    }

    expected = {
        "inputData": [{"initialData": "Hello input!"}],
        "configInputData": "Hello Config!",
        "newData": {"newKey1": "newData1"},
    }

    actual = initial_task.task(input, {})
    assert expected == actual
