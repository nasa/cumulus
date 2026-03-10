from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from src.add_input_granules.task import add_input_granules


@pytest.fixture
def cumulus_event() -> dict:
    """Return a test event dict for testing."""
    return {
        "input": {
            "pdr": {"name": "test-pdr.pdr", "path": "test-path"},
            "running": [],
            "failed": [],
            "completed": [],
        }
    }


@pytest.fixture
def mock_cumulus_api() -> Generator[MagicMock, None, None]:
    """Return mock CumulusApi instance."""
    with patch("src.add_input_granules.task.CumulusApi") as mock_api:
        mock_api_instance = MagicMock()
        mock_api.return_value = mock_api_instance
        mock_api_instance.get_execution.side_effect = lambda arn: {
            "finalPayload": {
                "granules": [
                    {
                        "granuleId": f"{arn.split(':')[-1]}-granule.nc",
                        "files": [
                            {
                                "fileName": f"{arn.split(':')[-1]}-granule.nc",
                                "bucket": "test-bucket",
                                "key": f"dir/{arn.split(':')[-1]}-granule.nc",
                                "size": 12345,
                                "type": "data",
                            }
                        ],
                    }
                ],
            }
        }
        yield mock_api_instance


def test_add_input_granules_success(cumulus_event, mock_cumulus_api) -> None:
    """Verify that granules from completed workflows are added to output."""
    cumulus_event["input"]["completed"] = [
        "arn:aws:states:us-west-2:123456789:execution:IngestWF:execution1",
        "arn:aws:states:us-west-2:123456789:execution:IngestWF:execution2",
    ]
    num_granules = 2
    result = add_input_granules(cumulus_event, {})

    assert "granules" in result
    assert len(result["granules"]) == num_granules
    assert result["granules"][0]["granuleId"] == "execution1-granule.nc"
    assert result["granules"][1]["granuleId"] == "execution2-granule.nc"


def test_add_input_granules_with_running_executions(cumulus_event) -> None:
    """Verify that exception is raised if there are running executions."""
    cumulus_event["input"]["running"] = [
        "arn:aws:states:us-west-2:123456789:execution:IngestWF:execution3",
    ]

    with pytest.raises(Exception, match="Executions still running"):
        add_input_granules(cumulus_event, {})


def test_add_input_granules_with_failed_executions(cumulus_event) -> None:
    """Verify that exception is raised if there are failed executions."""
    cumulus_event["input"]["failed"] = [
        {
            "arn": "arn:aws:states:us-west-2:123456789:execution:IngestWF:execution4",
            "reason": "Execution failed due to error",
        }
    ]

    with pytest.raises(Exception, match="Some executions failed"):
        add_input_granules(cumulus_event, {})
