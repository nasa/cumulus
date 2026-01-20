from task import TestProcess


def test_process():
    python_process = TestProcess({})

    input = {
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

    python_process.input = input
    expected = {
        "fake_output1": "first fake output",
        "fake_output2": "second fake output",
    }

    actual = python_process.process()
    assert expected == actual
