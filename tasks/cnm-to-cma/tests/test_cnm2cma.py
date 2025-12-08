from unittest.mock import patch
from cnm_to_cma import CNM2CMA
import json
from typing import List


class TestCNM2CMA:
    def setup_method(self):
        with patch("src.cnm2cma.cnm_to_cma.CNM2CMA.__init__", return_value=None):
            self.cnm2cma = CNM2CMA()

    def test_get_input_files(self):
        product = {"files": [{"name": "file1"}, {"name": "file2"}]}
        result = self.cnm2cma.get_input_files(product)
        assert result == [{"name": "file1"}, {"name": "file2"}]

        product = {
            "filegroups": [
                {"files": [{"name": "file3"}]},
                {"files": [{"name": "file4"}]},
            ]
        }
        result = self.cnm2cma.get_input_files(product)
        assert result == [{"name": "file3"}, {"name": "file4"}]

    def test_get_files(self):
        input_files = [
            {
                "uri": "s3://bucket/path/file1",
                "name": "file1",
                "size": 123,
                "type": "data",
            },
            {
                "uri": "https://host/path/file2",
                "name": "file2",
                "size": 456,
                "type": "data",
            },
            {
                "uri": "sftp://host/path/file3",
                "name": "file3",
                "size": 789,
                "type": "data",
            },
        ]
        result = self.cnm2cma.get_files(input_files)
        assert len(result) == 3
        assert result[0]["name"] == "file1"
        assert result[1]["name"] == "file2"
        assert result[2]["name"] == "file3"

    def test_file_groups(self):
        with open(
            "tests/resources/cumulus_sns_v1.1_filegroups_multiple.json", "r"
        ) as f:
            data = json.load(f)
            filegroups: List = data["product"]["filegroups"]
            assert len(filegroups) == 2
            assert len(filegroups[0]["files"]) == 2
            input_files = self.cnm2cma.get_input_files(data.get("product"))
            print(input_files)
            assert len(input_files) == 4
            file = input_files[3]
            assert (
                file["uri"]
                == "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.png"
            )

    def test_build_https_granule_file(self):
        cnm_file = {
            "uri": "https://host/path/to/file/file1.txt",
            "name": "file1.txt",
            "size": 100,
            "type": "data",
            "checksumType": "md5",
            "checksum": "abc123",
        }
        result = self.cnm2cma.build_https_granule_file(cnm_file)
        assert result["name"] == "file1.txt"
        assert result["path"] == "path/to/file"
        assert result["size"] == 100
        assert result["type"] == "data"
        assert result["checksumType"] == "md5"
        assert result["checksum"] == "abc123"

    def test_build_sftp_granule_file(self):
        cnm_file = {
            "uri": "sftp://host/path/to/file/file2.txt",
            "name": "file2.txt",
            "size": 200,
            "type": "metadata",
            "checksumType": "sha256",
            "checksum": "def456",
        }
        result = self.cnm2cma.build_sftp_granule_file(cnm_file)
        assert result["name"] == "file2.txt"
        assert result["path"] == "path/to/file"
        assert result["url_path"] == "sftp://host/path/to/file/file2.txt"
        assert result["size"] == 200
        assert result["type"] == "metadata"
        assert result["checksumType"] == "sha256"
        assert result["checksum"] == "def456"
