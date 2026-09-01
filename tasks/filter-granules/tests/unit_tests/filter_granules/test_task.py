from unittest.mock import MagicMock, patch

import pytest
from src.filter_granules.task import filter_granules


@pytest.fixture
def mock_cumulus_api():
    with patch("src.filter_granules.task.CumulusApi") as mock_api_class:
        mock_api_instance = MagicMock()
        mock_api_class.return_value = mock_api_instance
        yield mock_api_instance


@pytest.fixture
def base_event():
    return {
        "input": {"granules": []},
        "config": {
            "granuleIngestWorkflow": "IngestGranule",
            "filtering": True,
        },
    }


@pytest.fixture
def sample_granule():
    return {
        "granuleId": "test-granule-001",
        "dataType": "TEST_COLLECTION",
        "version": "V1",
    }


def test_filter_granules_with_completed_granule_and_matching_execution(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "completed",
    }

    mock_cumulus_api.search_executions_by_granules.return_value = {
        "results": [
            {
                "arn": "arn:aws:123:execution:IngestGranule:exec-001",
                "type": "IngestGranule",
            }
        ]
    }

    output = filter_granules(base_event, {})

    assert output["granules"] == []
    assert output["completed"] == ["arn:aws:123:execution:IngestGranule:exec-001"]
    mock_cumulus_api.get_granule.assert_called_once_with(
        granule_id="test-granule-001", collection_id="TEST_COLLECTION___V1"
    )


def test_filter_granules_with_failed_granule(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "failed",
    }

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        },
    ]
    assert output["completed"] == []


def test_filter_granules_with_granule_not_found(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "error": "Not Found",
        "message": "Granule not found",
        "statusCode": 404,
    }

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        }
    ]
    assert output["completed"] == []


def test_filter_granules_with_running_granule_raises_exception(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "running",
    }

    with pytest.raises(Exception, match="Granule still running: test-granule-001"):
        filter_granules(base_event, {})


def test_filter_granules_with_unknown_status_raises_exception(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "?????????",
    }

    with pytest.raises(Exception, match="Unknown Status for granule: test-granule-001"):
        filter_granules(base_event, {})


def test_filter_granules_completed_without_matching_workflow(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "completed",
    }

    mock_cumulus_api.search_executions_by_granules.return_value = {
        "results": [
            {
                "arn": "arn:aws:123:execution:OtherWorkflow:exec-001",
                "type": "OtherWorkflow",
            }
        ]
    }

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        },
    ]
    assert output["completed"] == []


def test_filter_granules_completed_with_empty_executions(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "completed",
    }

    mock_cumulus_api.search_executions_by_granules.return_value = {"results": []}

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        },
    ]
    assert output["completed"] == []


def test_filter_granules_completed_with_bad_executions_requests(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "completed",
    }

    mock_cumulus_api.search_executions_by_granules.return_value = {
        "error": "Bad Request",
        "message": "Record Does not Exist",
        "name": "RecordDoesNotExist",
        "statusCode": 400,
    }

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        },
    ]
    assert output["completed"] == []


def test_filter_granules_with_multiple_granules_mixed_statuses(
    mock_cumulus_api, base_event
):
    def get_granule_side_effect(granule_id, collection_id):
        statuses = {
            "granule-001": "completed",
            "granule-002": "failed",
            "granule-003": "completed",
        }
        return {
            "granuleId": granule_id,
            "collectionId": collection_id,
            "status": statuses[granule_id],
        }

    def search_executions_side_effect(search_def, limit, sort_by, order):
        granule_id = search_def["granules"][0]["granuleId"]
        if granule_id == "granule-001":
            return {
                "results": [
                    {
                        "arn": f"arn:aws:123:execution:IngestGranule:{granule_id}",
                        "type": "IngestGranule",
                    }
                ]
            }
        else:
            return {"results": []}

    granules = [
        {"granuleId": "granule-001", "dataType": "TEST_COLLECTION", "version": "V1"},
        {"granuleId": "granule-002", "dataType": "TEST_COLLECTION", "version": "V1"},
        {"granuleId": "granule-003", "dataType": "TEST_COLLECTION", "version": "V1"},
    ]
    base_event["input"]["granules"] = granules

    mock_cumulus_api.get_granule.side_effect = get_granule_side_effect
    mock_cumulus_api.search_executions_by_granules.side_effect = (
        search_executions_side_effect
    )

    output = filter_granules(base_event, {})
    expected_granule_len = 2

    assert len(output["granules"]) == expected_granule_len
    assert output["completed"] == ["arn:aws:123:execution:IngestGranule:granule-001"]


def test_filter_granules_with_empty_granules_list(mock_cumulus_api, base_event):
    base_event["input"]["granules"] = []

    output = filter_granules(base_event, {})

    assert output["granules"] == []
    assert output["completed"] == []
    mock_cumulus_api.get_granule.assert_not_called()


def test_filter_granules_returns_unused_inputs(
    mock_cumulus_api, base_event, sample_granule
):
    base_event["input"]["granules"] = [sample_granule]
    base_event["input"]["otherField"] = "field value and stuffff"

    mock_cumulus_api.get_granule.return_value = {
        "granuleId": "test-granule-001",
        "collectionId": "TEST_COLLECTION___V1",
        "status": "failed",
    }

    output = filter_granules(base_event, {})

    assert "granules" in output
    assert "completed" in output
    assert "otherField" in output


def test_filter_granules_no_filtering(mock_cumulus_api, base_event, sample_granule):
    base_event["input"]["granules"] = [sample_granule]
    base_event["config"]["filtering"] = False

    output = filter_granules(base_event, {})

    assert output["granules"] == [
        {
            "granuleId": "test-granule-001",
            "dataType": "TEST_COLLECTION",
            "version": "V1",
        }
    ]

    mock_cumulus_api.get_granule.assert_not_called()
