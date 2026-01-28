from unittest.mock import MagicMock

import pytest
from task import PythonProcess


@pytest.fixture
def python_process():
    return PythonProcess({})


def test_process(mocker, python_process):
    mocker.patch.object(
        python_process, "clean_output", return_value=MagicMock(return_value=True)
    )
    mocker.patch.object(
        python_process, "add_ancillary_file", return_value="test_data_file.md5"
    )
    mocker.patch.object(python_process, "fetch", return_value=["test_data_file.hdf"])

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
    expected = ["test_data_file.md5", "s3://test-bucket/test_data_file.hdf"]
    actual = python_process.process()

    assert expected == actual
    python_process.clean_output.assert_called()
    python_process.add_ancillary_file.assert_called_with("test_data_file.hdf")
    python_process.fetch.assert_called_with("hdf", remote=False)


def test_add_ancillary_files(mocker, python_process):
    python_process.config = {
        "collection": {
            "name": "TEST_COLLECTION",
            "version": "TEST_VERSION",
        },
        "buckets": {
            "internal": {
                "name": "test internal bucket",
            }
        },
        "stack": "test-stack",
    }

    mocker.patch.object(python_process, "_write_md5sum_file", return_value=True)
    mocker.patch.object(python_process, "_get_md5_sum", return_value="fake_md5_hash")

    mock_upload = mocker.patch("task.upload")

    actual = python_process.add_ancillary_file("test_data_file.hdf")
    expected = (
        "s3://test internal bucket/staging/test-stack/"
        "TEST_COLLECTION__TEST_VERSION/test_data_file.hdf.md5"
    )

    assert expected == actual
    python_process._write_md5sum_file.assert_called_with(
        "test_data_file.hdf.md5", "fake_md5_hash"
    )
    python_process._get_md5_sum.assert_called_with("test_data_file.hdf")

    mock_upload.assert_called_with("test_data_file.hdf.md5", expected)
