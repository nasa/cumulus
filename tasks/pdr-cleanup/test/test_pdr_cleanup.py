import os
from unittest.mock import MagicMock, patch

import pytest
from freezegun import freeze_time
from pdr_cleanup import cleanup_pdr, move_pdr


@pytest.fixture
def successful_event():
    return {
        "config": {
            "provider": {
                "host": "test-bucket",
                "protocol": "s3",
            },
        },
        "input": {
            "pdr": {
                "name": "test-pdr.PDR",
                "path": "dropbox",
            },
            "failed": [],
        },
    }


@pytest.fixture
def failed_event():
    return {
        "config": {
            "provider": {
                "host": "test-bucket",
                "protocol": "s3",
            },
        },
        "input": {
            "pdr": {
                "name": "test-pdr.PDR",
                "path": "dropbox",
            },
            "failed": [
                {"arn": 123, "reason": "failure"},
                {"arn": 456, "reason": "failure"},
            ],
        },
    }


@pytest.fixture
def mock_context():
    return {}


@patch("pdr_cleanup.move_pdr")
def test_cleanup_pdr_success(mock_move_pdr, successful_event, mock_context):
    output = cleanup_pdr(successful_event, mock_context)

    mock_move_pdr.assert_called_once_with(
        successful_event["config"]["provider"], successful_event["input"]["pdr"]
    )

    assert output == {
        "pdr": {
            "name": "test-pdr.PDR",
            "path": "dropbox",
        },
        "failed": [],
    }


def test_cleanup_pdr_with_failed_workflows(failed_event, mock_context):
    with pytest.raises(Exception):
        cleanup_pdr(failed_event, mock_context)


@patch("pdr_cleanup.boto3.client")
@freeze_time("2025-4-2 01:01:01")
def test_move_pdr_success(mock_boto3_client, successful_event):
    mock_s3_client = MagicMock()
    mock_boto3_client.return_value = mock_s3_client

    provider = successful_event["config"]["provider"]
    pdr = successful_event["input"]["pdr"]

    src_path = os.path.join(pdr["path"], pdr["name"])
    dest_path = os.path.join("PDRs", pdr["path"], "2025.04.02", pdr["name"])

    move_pdr(provider, pdr)

    mock_s3_client.copy_object.assert_called_once_with(
        CopySource=os.path.join(provider["host"], src_path),
        Bucket=provider["host"],
        Key=dest_path,
    )

    mock_s3_client.delete_object.assert_called_once_with(
        Bucket=provider["host"], Key=src_path
    )


@patch("boto3.client")
def test_move_pdr_copy_failure(mock_boto3_client, successful_event):
    mock_s3_client = MagicMock()
    mock_s3_client.copy_object.side_effect = Exception("Copy failed")
    mock_boto3_client.return_value = mock_s3_client

    provider = successful_event["config"]["provider"]
    pdr = successful_event["input"]["pdr"]

    with pytest.raises(Exception):
        move_pdr(provider, pdr)

    mock_s3_client.delete_object.assert_not_called()


@patch("boto3.client")
def test_move_pdr_non_s3_provider(mock_boto3_client, successful_event):
    mock_s3_client = MagicMock()
    mock_boto3_client.return_value = mock_s3_client

    provider = successful_event["config"]["provider"]
    provider["protocol"] = "sftp"
    pdr = successful_event["input"]["pdr"]

    with pytest.raises(Exception, match=r"protocol is \(sftp\)"):
        move_pdr(provider, pdr)
    mock_s3_client.delete_object.assert_not_called()


@patch("boto3.client")
def test_move_pdr_delete_failure(mock_boto3_client, successful_event):
    mock_s3_client = MagicMock()
    mock_s3_client.delete_object.side_effect = Exception("Delete failed")
    mock_boto3_client.return_value = mock_s3_client

    provider = successful_event["config"]["provider"]
    pdr = successful_event["input"]["pdr"]

    with pytest.raises(Exception):
        move_pdr(provider, pdr)

    mock_s3_client.copy_object.assert_called_once()
