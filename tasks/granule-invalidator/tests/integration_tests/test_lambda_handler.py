import pytest
from freezegun import freeze_time
from jsonschema.exceptions import ValidationError
from main import lambda_handler


@freeze_time("2026-01-01 20:50:35Z")
def test_lambda_handler(mocked_api):
    def mock_list_granules(*args, **kwargs) -> dict:
        if kwargs.get("countOnly") is True:
            return {
                "meta": {
                    "count": 1,
                },
            }

        return {
            "meta": {
                "count": 1,
            },
            "results": [
                {
                    "granuleId": "TEST-GRANULE_1",
                    "productionDateTime": "2020-01-01 00:00:00Z",
                },
            ],
        }

    mocked_api.return_value.list_granules = mock_list_granules

    output = lambda_handler(
        {
            "cma": {
                "event": {},
                "task_config": {
                    "granule_invalidations": [
                        {
                            "type": "science_date",
                            "maximum_minutes_old": 60408,
                        }
                    ],
                    "collection": "SOME_COLLECTION",
                    "version": "1",
                },
                "payload": {},
            },
        },
        None,
    )

    assert output == {
        "exception": "None",
        "payload": {
            "aggregated_stats": (
                "Total number of granules to be removed: 1\n"
                "Total number of granules to be retained: 0\n"
                "Granules to be removed by invalidation type:\n"
                "science_date - 1 granules\n"
            ),
            "forceRemoveFromCmr": True,
            "granules": [
                "TEST-GRANULE_1",
            ],
            "granules_to_be_deleted_count": 1,
        },
        "task_config": {
            "collection": "SOME_COLLECTION",
            "granule_invalidations": [
                {
                    "maximum_minutes_old": 60408,
                    "type": "science_date",
                },
            ],
            "version": "1",
        },
    }


@freeze_time("2026-01-01 20:50:35Z")
def test_lambda_handler_config_validation():
    with pytest.raises(ValidationError, match="Failed validating 'minItems'"):
        lambda_handler(
            {
                "cma": {
                    "event": {},
                    "task_config": {
                        "granule_invalidations": [],
                        "collection": "SOME_COLLECTION",
                        "version": "1",
                    },
                    "payload": {},
                },
            },
            None,
        )

    with pytest.raises(ValidationError, match="Failed validating 'anyOf'"):
        lambda_handler(
            {
                "cma": {
                    "event": {},
                    "task_config": {
                        "granule_invalidations": [
                            {
                                "type": "cross_collection",
                                "invalidating_collection": "SOME_COLLECTION_1",
                            },
                        ],
                        "collection": "SOME_COLLECTION",
                        "version": "1",
                    },
                    "payload": {},
                },
            },
            None,
        )
