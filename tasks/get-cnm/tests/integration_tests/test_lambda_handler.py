"""Tests for get cnm module lambda handler."""

import json

import jsonschema
import pytest
from main import lambda_handler


def test_lambda_handler_nominal(mocked_api, data_path) -> None:
    """Verify that lambda_adapter succeeds when provided with a single granule with a
    parent arn that maps to an execution with a cnm message.
    """
    with (data_path / "input.json").open() as f:
        event = json.load(f)
    with (data_path / "cnm.json").open() as f:
        cnm = json.load(f)

    granule_id = event["cma"]["event"]["payload"]["granules"][0]["granuleId"]
    execution_list_response = {
        "results": [
            {
                "finalPayload": {"granules": [{"granuleId": granule_id}]},
                "createdAt": 0,
                "parentArn": "[parent arn]",
            }
        ]
    }

    execution_response = {"originalPayload": cnm}
    mocked_api.return_value.search_executions_by_granules.return_value = (
        execution_list_response
    )
    mocked_api.return_value.get_execution.return_value = execution_response
    output = lambda_handler(event, None)

    assert output["payload"] == {
        "ATL08_20260222023208_00000000_006_02.h5_9UBgbmQK": {
            "collection": "[collection name]",
            "identifier": "78b52d92-ff70-4633-94b1-94e10bf03d11",
            "product": {
                "dataVersion": "[collection version]",
                "files": [
                    {
                        "name": "[file name]",
                        "size": 0,
                        "type": "data",
                        "uri": "[uri]",
                    },
                ],
                "name": "ATL08_20260222023208_00000000_006_02.h5_9UBgbmQK",
            },
            "provider": "[provider name]",
            "submissionTime": "2026-02-25T02:32:12",
            "version": "1.3",
        },
    }


def test_lambda_handler_raises_on_invalid_cnm(mocked_api, data_path) -> None:
    """Verify that lambda_adapter raises a jsonschema error when the returned message
    is not in valid CNM format.
    """
    with (data_path / "input.json").open() as f:
        event = json.load(f)

    granule_id = event["cma"]["event"]["payload"]["granules"][0]["granuleId"]
    execution_list_response = {
        "results": [
            {
                "finalPayload": {"granules": [{"granuleId": granule_id}]},
                "parentArn": "[parent arn]",
                "createdAt": 0,
            }
        ]
    }

    execution_response = {
        "originalPayload": {"product": {"name": granule_id}},  # not a valid CNM message
        "createdAt": 0,
    }

    mocked_api.return_value.search_executions_by_granules.return_value = (
        execution_list_response
    )
    mocked_api.return_value.get_execution.return_value = execution_response

    with pytest.raises(jsonschema.ValidationError):
        lambda_handler(event, None)
