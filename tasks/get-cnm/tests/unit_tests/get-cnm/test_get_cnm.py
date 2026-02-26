"""Tests for get cnm module."""

import re
from unittest.mock import patch

import pytest
from get_cnm.get_cnm import lambda_adapter


def test_lambda_adapter_returns_one_cnm() -> None:
    """Verify lambda_adapter returns the CNM message associated with the granule."""
    input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": input_granule_name, "collectionId": "ATL12___007"}
            ]
        }
    }
    original_cnm_message = {
        "product": {"name": "ATL12_20181014154641_02450101_007_02.h5"}
    }
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
            {
                # This execution should be ignored since it's newer than the first one
                "originalPayload": {},
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": input_granule_name,
                            "createdAt": 2,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
        ],
    }
    with patch(
        "cumulus_api.CumulusApi.search_executions_by_granules",
        return_value=search_executions_by_granules_response,
    ) as _:
        result = lambda_adapter(input_event, None)
        assert result == {input_granule_name: original_cnm_message}


def test_lambda_adapter_returns_one_cnm_with_parent_arn() -> None:
    """Verify lambda_adapter returns the CNM message associated with the granule."""
    input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": input_granule_name, "collectionId": "ATL12___007"}
            ]
        }
    }
    original_cnm_message = {
        "product": {"name": "ATL12_20181014154641_02450101_007_02.h5"}
    }
    parent_execution_arn = "arn_to_parent_execution"
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": {},
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
                "parentArn": parent_execution_arn,
            }
        ],
    }
    parent_execution_response = {
        "originalPayload": original_cnm_message,
        "finalPayload": {
            "granules": [
                {
                    "files": [],
                    "version": "007",
                    "dataType": "ATL12",
                    "granuleId": input_granule_name,
                    "createdAt": 1,
                }
            ],
        },
        "collectionId": "ATL12___007",
    }
    with (
        patch(
            "cumulus_api.CumulusApi.search_executions_by_granules",
            return_value=search_executions_by_granules_response,
        ),
        patch(
            "cumulus_api.CumulusApi.get_execution",
            return_value=parent_execution_response,
        ) as get_execution_patch,
    ):
        result = lambda_adapter(input_event, None)
        assert result == {input_granule_name: original_cnm_message}
        get_execution_patch.assert_called_once_with(parent_execution_arn)


def test_lambda_adapter_returns_multiple_cnm() -> None:
    """Verify that lambda_adapter returns the CNM message associated with the granule
    when multiple granules are specified.
    """
    first_input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    second_input_granule_name = "ATL12_20181014155468_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": first_input_granule_name, "collectionId": "ATL12___007"},
                {"granuleId": second_input_granule_name, "collectionId": "ATL12___007"},
            ]
        }
    }
    first_original_cnm_message = {
        "product": {"name": "ATL12_20181014154641_02450101_007_02.h5"}
    }
    second_original_cnm_message = {
        "product": {"name": "ATL12_20181014155468_02450101_007_02.h5"}
    }
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": first_original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": first_input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
            {
                # This execution should be ignored since it's newer than the first one
                "originalPayload": {},
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": first_input_granule_name,
                            "createdAt": 2,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
            {
                "originalPayload": second_original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": second_input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
            {
                # This execution should be ignored since it's newer than the first one
                "originalPayload": {},
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": second_input_granule_name,
                            "createdAt": 2,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            },
        ],
    }
    with patch(
        "cumulus_api.CumulusApi.search_executions_by_granules",
        return_value=search_executions_by_granules_response,
    ) as _:
        result = lambda_adapter(input_event, None)
        assert result == {
            first_input_granule_name: first_original_cnm_message,
            second_input_granule_name: second_original_cnm_message,
        }


def test_lambda_adapter_raises_on_no_executions_found() -> None:
    """Verify an exception is raised if an execution is not returned for a granule."""
    first_input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    second_input_granule_name = "ATL12_20181014155468_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": first_input_granule_name, "collectionId": "ATL12___007"},
                {"granuleId": second_input_granule_name, "collectionId": "ATL12___007"},
            ]
        }
    }
    first_original_cnm_message = {
        "product": {"name": "ATL12_20181014154641_02450101_007_02.h5"}
    }
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": first_original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": first_input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            }
        ],
    }
    with (
        patch(
            "cumulus_api.CumulusApi.search_executions_by_granules",
            return_value=search_executions_by_granules_response,
        ) as _,
        pytest.raises(
            ValueError,
            match=f"No executions found for granule {second_input_granule_name}",
        ),
    ):
        lambda_adapter(input_event, None)


def test_lambda_adapter_raises_on_cnm_granule_mismatch() -> None:
    """Verify that an exception is raised if the CNM granule ID does not match the
    input granule ID.
    """
    first_input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": first_input_granule_name, "collectionId": "ATL12___007"},
            ]
        }
    }
    first_original_cnm_message = {"product": {"name": "NOT_THE_GRANULE_ID"}}
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": first_original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": first_input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            }
        ],
    }
    with (
        patch(
            "cumulus_api.CumulusApi.search_executions_by_granules",
            return_value=search_executions_by_granules_response,
        ) as _,
        pytest.raises(
            ValueError,
            match=re.escape(
                f"Found differing granule IDs for granule in CNM message "
                f"({first_original_cnm_message['product']['name']}) and "
                f"Cumulus message ({first_input_granule_name})"
            ),
        ),
    ):
        lambda_adapter(input_event, None)


def test_lambda_adapter_raises_on_cnm_granule_missing() -> None:
    """Verify that an exception is raised if the CNM granule ID does not match the
    input granule ID.
    """
    first_input_granule_name = "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W"
    input_event = {
        "input": {
            "granules": [
                {"granuleId": first_input_granule_name, "collectionId": "ATL12___007"},
            ]
        }
    }
    first_original_cnm_message = {}
    search_executions_by_granules_response = {
        "results": [
            {
                "originalPayload": first_original_cnm_message,
                "finalPayload": {
                    "granules": [
                        {
                            "files": [],
                            "version": "007",
                            "dataType": "ATL12",
                            "granuleId": first_input_granule_name,
                            "createdAt": 1,
                        }
                    ],
                },
                "collectionId": "ATL12___007",
            }
        ],
    }
    with (
        patch(
            "cumulus_api.CumulusApi.search_executions_by_granules",
            return_value=search_executions_by_granules_response,
        ) as _,
        pytest.raises(
            ValueError,
            match=re.escape(
                f"Found differing granule IDs for granule in CNM message (None) and "
                f"Cumulus message ({first_input_granule_name})"
            ),
        ),
    ):
        lambda_adapter(input_event, None)
