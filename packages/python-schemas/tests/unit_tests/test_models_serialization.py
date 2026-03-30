from unittest import mock

from python_schemas.models.granule import File, Granule


def test_file():
    assert File.model_json_schema() == {
        "title": "File",
        "description": "CMA granule file model.",
        "type": "object",
        "required": ["bucket", "key"],
        "additionalProperties": False,
        "properties": {
            "bucket": {
                "title": "Bucket",
                "description": "Bucket where file is archived in S3",
                "type": "string",
            },
            "checksum": {
                "title": "Checksum",
                "description": "Checksum value for file",
                "type": "string",
            },
            "checksumType": {
                "title": "ChecksumType",
                "description": "Type of checksum (e.g. md5, sha256, etc)",
                "type": "string",
            },
            "fileName": {
                "title": "FileName",
                "description": "Name of file (e.g. file.txt)",
                "type": "string",
            },
            "key": {
                "title": "Key",
                "description": "S3 Key for archived file",
                "type": "string",
            },
            "size": {
                "title": "Size",
                "description": "Size of file (in bytes)",
                "type": "number",
            },
            "source": {
                "title": "Source",
                "description": (
                    "Source URI of the file from origin system (e.g. S3, FTP, HTTP)"
                ),
                "type": "string",
            },
            "type": {
                "title": "Type",
                "description": "Type of file (e.g. data, metadata, browse)",
                "type": "string",
            },
        },
    }


def test_granule():
    assert Granule.model_json_schema() == {
        "$defs": mock.ANY,
        "title": "Granule",
        "description": "CMA granule model.",
        "type": "object",
        "properties": {
            "files": {
                "items": {
                    "$ref": "#/$defs/File",
                },
                "title": "Files",
                "type": "array",
            },
            "granuleId": {
                "title": "GranuleId",
                "type": "string",
            },
        },
        "required": [
            "granuleId",
            "files",
        ],
    }
