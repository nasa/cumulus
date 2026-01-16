"""Tests for granule invalidation module.

This test module contains unit tests for granule invalidation functions
including science_date, ingest_date, and cross_collection invalidations.
"""

import datetime
from unittest.mock import patch

import pytest
from granule_invalidator import granule_invalidator, invalidations


def test_run_invalidation_science_date_invalidation() -> None:
    """Verify that run_invalidation calls the science_date invalidation function."""
    patch_path = 'granule_invalidator.invalidations.science_date'
    with patch(patch_path) as science_date_invalidation:
        granule_invalidator.run_invalidation([], {'type': 'science_date'})
        science_date_invalidation.assert_called_once()


def test_run_invalidation_ingest_date_invalidation() -> None:
    """Verify that run_invalidation calls the ingest_date invalidation function."""
    patch_path = 'granule_invalidator.invalidations.ingest_date'
    with patch(patch_path) as ingest_date_invalidation:
        granule_invalidator.run_invalidation([], {'type': 'ingest_date'})
        ingest_date_invalidation.assert_called_once()


def test_run_invalidation_cross_collection_invalidation() -> None:
    """Verify that run_invalidation calls the cross_collection invalidation function."""
    patch_path = 'granule_invalidator.invalidations.cross_collection'
    with patch(patch_path) as cross_collection_invalidation:
        granule_invalidator.run_invalidation([], {'type': 'cross_collection'})
        cross_collection_invalidation.assert_called_once()


def test_run_invalidation_raise() -> None:
    """Verify that run_invalidation raises ValueError for invalid invalidation type."""
    with pytest.raises(ValueError):
        granule_invalidator.run_invalidation([], {'type': 'nonexistent'})


def test_identify_granules_older_than() -> None:
    """Verify correct separation of valid and invalid granules by age."""
    now = '2021-01-01T00:14:30Z'
    granules = [
        {'productionDateTime': '2021-01-01T00:14:00Z'},
        {'productionDateTime': '2021-01-01T00:13:00Z'},
    ]
    comparison_key = 'productionDateTime'

    def comparison_key_transformation(datetime_representation):
        return datetime.datetime.fromisoformat(datetime_representation)

    expiration_time = datetime.timedelta(minutes=1)
    patch_path = 'granule_invalidator.invalidations.datetime'
    with patch(patch_path, wraps=datetime.datetime) as datetime_mock:
        datetime_mock.now.return_value = datetime.datetime.fromisoformat(now)
        valid_granules, invalid_granules = invalidations.identify_granules_older_than(
            granules, comparison_key, comparison_key_transformation, expiration_time
        )
    assert len(valid_granules) == 1
    assert len(invalid_granules) == 1


def test_science_date_invalidation() -> None:
    """Verify that science_date invalidation correctly identifies old granules."""
    now = '2021-01-01T00:14:30Z'
    granules = [
        {'productionDateTime': '2021-01-01T00:14:00Z'},
        {'productionDateTime': '2021-01-01T00:13:00Z'},
    ]
    granule_invalidation_information = {'maximum_minutes_old': 1}
    patch_path = 'granule_invalidator.invalidations.datetime'
    with patch(patch_path, wraps=datetime.datetime) as datetime_mock:
        datetime_mock.now.return_value = datetime.datetime.fromisoformat(now)
        valid_granules, invalid_granules = invalidations.science_date(
            granules, granule_invalidation_information
        )
    assert len(valid_granules) == 1
    assert len(invalid_granules) == 1


def test_ingest_date_invalidation() -> None:
    """Verify that ingest_date invalidation correctly identifies old granules."""
    now = '2021-01-01T00:14:30Z'
    # 1609460040000 = '2021-01-01T00:14:00Z'
    # 1609459980000 = '2021-01-01T00:13:00Z'
    granules = [{'createdAt': 1609460040000}, {'createdAt': 1609459980000}]
    granule_invalidation_information = {'maximum_minutes_old': 1}
    patch_path = 'granule_invalidator.invalidations.datetime'
    with patch(patch_path, wraps=datetime.datetime) as datetime_mock:
        datetime_mock.now.return_value = datetime.datetime.fromisoformat(now)
        valid_granules, invalid_granules = invalidations.ingest_date(
            granules, granule_invalidation_information
        )
    assert len(valid_granules) == 1
    assert len(invalid_granules) == 1


def test_cross_collection_invalidation() -> None:
    """Verify cross_collection identifies superseded granules."""
    granules = [
        {
            'beginningDateTime': '2021-01-01T00:14:00Z',
            'endingDateTime': '2021-01-01T00:14:30Z',
        },  # invalid - matches a granule returned by fetch_all_granules
        {
            'beginningDateTime': '2021-01-01T00:13:00Z',
            'endingDateTime': '2021-01-01T00:13:30Z',
        },  # invalid - matches a granule returned by fetch_all_granules
        {
            'beginningDateTime': '2021-01-01T00:12:00Z',
            'endingDateTime': '2021-01-01T00:12:30Z',
        },  # valid - doesn't match a granule returned by fetch_all_granules
    ]
    num_invalid_granules = 2
    num_valid_granules = 1
    granule_invalidation_information = {
        'invalidating_collection': 'collection',
        'invalidating_version': 'version',
    }
    patch_path = 'granule_invalidator.granule_invalidator.fetch_all_granules'
    with patch(patch_path) as fetch_all_granules:
        fetch_all_granules.return_value = [
            {
                'beginningDateTime': '2021-01-01T00:14:00Z',
                'endingDateTime': '2021-01-01T00:14:30Z',
            },
            {
                'beginningDateTime': '2021-01-01T00:13:00Z',
                'endingDateTime': '2021-01-01T00:13:30Z',
            },
            {
                'beginningDateTime': '2021-01-01T00:12:10Z',
                'endingDateTime': '2021-01-01T00:12:30Z',
            },
            {
                'beginningDateTime': '2021-01-01T00:12:00Z',
                'endingDateTime': '2021-01-01T00:12:10Z',
            },
        ]
        valid_granules, invalid_granules = invalidations.cross_collection(
            granules, granule_invalidation_information
        )
    assert len(valid_granules) == num_valid_granules
    assert len(invalid_granules) == num_invalid_granules
