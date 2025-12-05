import unittest
from unittest.mock import MagicMock, patch

from process_activity import PythonProcess


class Test(unittest.TestCase):
    def test_process(self):
        process_object = PythonProcess({})

        process_object.clean_output = MagicMock(return_value=True)
        process_object.add_ancillary_file = MagicMock(return_value="test_data_file.md5")
        process_object.fetch = MagicMock(return_value=["test_data_file.hdf"])

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

        process_object.input = input
        expected = ["test_data_file.md5", "s3://test-bucket/test_data_file.hdf"]
        actual = process_object.process()

        self.assertEqual(expected, actual)
        process_object.clean_output.assert_called()
        process_object.add_ancillary_file.assert_called_with("test_data_file.hdf")
        process_object.fetch.assert_called_with("hdf", remote=False)

    @patch("process_activity.upload")
    def test_add_ancillary_files(self, upload_mock):
        process_object = PythonProcess({})
        process_object.config = {
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
        process_object._write_md5sum_file = MagicMock(return_value=True)
        process_object._get_md5_sum = MagicMock(return_value="fake_md5_hash")

        actual = process_object.add_ancillary_file("test_data_file.hdf")
        expected = (
            "s3://test internal bucket/staging/test-stack/"
            "TEST_COLLECTION__TEST_VERSION/test_data_file.hdf.md5"
        )

        self.assertEqual(expected, actual)
        process_object._write_md5sum_file.assert_called_with(
            "test_data_file.hdf.md5", "fake_md5_hash"
        )
        process_object._get_md5_sum.assert_called_with("test_data_file.hdf")
        upload_mock.assert_called_with("test_data_file.hdf.md5", expected)
