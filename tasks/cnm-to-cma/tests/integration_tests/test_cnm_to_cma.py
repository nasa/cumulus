import json

import jsonschema
import pytest
from freezegun import freeze_time

from main import lambda_handler


@freeze_time("2026-01-01 20:50:35Z")
def test_lambda_handler_input_schema_validation(data_path):
    with (
        data_path / "cumulus_sns_v1.0_notification_incorrect_formatted.json"
    ).open() as f:
        data = json.load(f)

    with pytest.raises(
        jsonschema.exceptions.ValidationError,
        match="Failed validating 'anyOf'",
    ):
        lambda_handler(
            {
                "cma": {
                    "event": {
                        "collection": {
                            "name": "test_collection",
                            "version": "001",
                            "granuleIdExtraction": None,
                        },
                    },
                    "task_config": {
                        "collection": "{$.collection}",
                    },
                    "payload": data,
                },
            },
            None,
        )


@freeze_time("2026-01-01 20:50:35Z")
def test_lambda_handler_output_schema_validation(data_path):
    with (data_path / "cumulus_sns_v1.0_notification.json").open() as f:
        data = json.load(f)

    output = lambda_handler(
        {
            "cma": {
                "event": {
                    "collection": {
                        "name": "test_collection",
                        "version": "001",
                    },
                },
                "task_config": {
                    "collection": "{$.collection}",
                },
                "payload": data,
            },
        },
        None,
    )

    assert output == {
        "collection": {
            "name": "test_collection",
            "version": "001",
        },
        "task_config": {
            "collection": "{$.collection}",
        },
        "exception": "None",
        "payload": {
            "cnm": {
                "collection": "SWOT_Prod_l2:1",
                "identifier": "1234-abcd-efg0-9876",
                "product": {
                    "dataVersion": "001",
                    "files": [
                        {
                            "checksum": "4241jafkjaj14jasjf",
                            "checksumType": "md5",
                            "name": "production_file.nc",
                            "size": 123456,
                            "type": "data",
                            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.nc",
                        },
                        {
                            "checksum": "addjd872342bfbf",
                            "checksumType": "md5",
                            "name": "production_file.png",
                            "size": 12345,
                            "type": "browse",
                            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.png",
                        },
                    ],
                    "name": "sampleGranuleName001",
                    "producerGranuleId": "producerGranuleId_from_data_provider",
                },
                "provider": "PODAAC_SWOT",
                "receivedTime": "2026-01-01T20:50:35.000+00:00Z",
                "submissionTime": "2017-09-30T03:42:29.791198Z",
                "version": "1.0",
            },
            "granules": [
                {
                    "dataType": "test_collection",
                    "files": [
                        {
                            "filename": "production_file.nc",
                            "name": "production_file.nc",
                            "path": "prod_20170926T11:30:36",
                            "source_bucket": "sampleIngestBucket",
                            "type": "data",
                        },
                        {
                            "filename": "production_file.png",
                            "name": "production_file.png",
                            "path": "prod_20170926T11:30:36",
                            "source_bucket": "sampleIngestBucket",
                            "type": "browse",
                        },
                    ],
                    "granuleId": "sampleGranuleName001",
                    "producerGranuleId": "producerGranuleId_from_data_provider",
                    "version": "001",
                },
            ],
        },
    }
