"""Tests for get cnm module lambda handler."""

import json
from pathlib import Path
from unittest.mock import patch

import jsonschema
import pytest
from main import lambda_handler


def test_lambda_handler_nominal() -> None:
    """Verify that lambda_adapter succeeds when provided with a single granule with a
    parent arn that maps to an execution with a cnm message.
    """
    with open(Path(__file__).with_name("input.json")) as f:
        event = json.load(f)
    with open(Path(__file__).with_name("cnm.json")) as f:
        cnm = json.load(f)
    granule_id = event["cma"]["event"]["payload"]["granules"][0]["granuleId"]
    execution_list_response = {
        "results": [
            {
                "finalPayload": {
                    "granules": [{"granuleId": granule_id, "createdAt": 0}]
                },
                "parentArn": "[parent arn]",
            }
        ]
    }

    execution_response = {"originalPayload": cnm}

    with (
        patch(
            "get_cnm.get_cnm.CumulusApi.search_executions_by_granules",
            return_value=execution_list_response,
        ),
        patch(
            "get_cnm.get_cnm.CumulusApi.get_execution", return_value=execution_response
        ),
    ):
        lambda_handler(event, None)


def test_lambda_handler_raises_on_invalid_cnm() -> None:
    """Verify that lambda_adapter raises a jsonschema error when the returned message
    is not in valid CNM format.
    """
    with open(Path(__file__).with_name("input.json")) as f:
        event = json.load(f)
    granule_id = event["cma"]["event"]["payload"]["granules"][0]["granuleId"]
    execution_list_response = {
        "results": [
            {
                "finalPayload": {
                    "granules": [{"granuleId": granule_id, "createdAt": 0}]
                },
                "parentArn": "[parent arn]",
            }
        ]
    }

    execution_response = {
        "originalPayload": {"product": {"name": granule_id}}  # not a valid CNM message
    }

    with (
        patch(
            "get_cnm.get_cnm.CumulusApi.search_executions_by_granules",
            return_value=execution_list_response,
        ),
        patch(
            "get_cnm.get_cnm.CumulusApi.get_execution", return_value=execution_response
        ),
        pytest.raises(jsonschema.ValidationError),
    ):
        lambda_handler(event, None)
