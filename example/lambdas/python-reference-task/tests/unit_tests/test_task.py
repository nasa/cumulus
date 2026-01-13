import task


def test_process():
    event = {
        "input": {"initialData": "Hello input!"},
        "config": {"configData": "Hello Config!"},
    }

    expected = {
        "inputData": "Hello input!",
        "configInputData": "Hello Config!",
        "newData": {"newKey1": "newData1"},
    }

    actual = task.task(event, {})
    assert expected == actual
