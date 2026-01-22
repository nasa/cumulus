"""Granule invalidation functions for different criteria.

This module provides functions to identify and invalidate granules based on
various criteria including science date, ingest date, and cross-collection.
"""

import logging
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from cumulus_logger import CumulusLogger

from . import granule_invalidator

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))


def science_date(
    granules: list[dict], granule_invalidation_information: dict
) -> tuple[list[dict], list[dict]]:
    """Identify granules older than specified age based on productionDateTime.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation
            containing, at minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.

    """
    expiration_timedelta = timedelta(
        minutes=granule_invalidation_information.get("maximum_minutes_old")
    )
    comparison_key = "productionDateTime"

    def comparison_key_transformation(datetime_representation):
        return datetime.fromisoformat(datetime_representation)

    return identify_granules_older_than(
        granules, comparison_key, comparison_key_transformation, expiration_timedelta
    )


def ingest_date(
    granules: list[dict], granule_invalidation_information: dict
) -> tuple[list[dict], list[dict]]:
    """Identify granules older than specified age based on createdAt datetime.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation
            containing, at minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.

    """
    expiration_timedelta = timedelta(
        minutes=granule_invalidation_information.get("maximum_minutes_old")
    )
    comparison_key = "createdAt"

    def comparison_key_transformation(datetime_representation):
        return datetime.fromtimestamp(datetime_representation / 1000, UTC)

    return identify_granules_older_than(
        granules, comparison_key, comparison_key_transformation, expiration_timedelta
    )


def cross_collection(
    granules: list[dict], granule_invalidation_information: dict
) -> tuple[list[dict], list[dict]]:
    """Identify granules superseded by granules in another collection.

    Granules are considered superseded when they have identical productionDateTime
    values in both collections.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation
            containing, at minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.

    """
    coll = granule_invalidation_information.get("invalidating_collection")
    version = granule_invalidation_information.get("invalidating_version")
    begin_date_key = "beginningDateTime"
    end_date_key = "endingDateTime"
    # Identify the oldest date to filter on granules newer than that
    datetime_list = [
        datetime.fromisoformat(granule[begin_date_key])
        for granule in granules
        if granule.get(begin_date_key)
    ]
    if not datetime_list:
        LOGGER.info(
            "No granules with valid beginningDateTime found, "
            "skipping cross collection invalidation"
        )
        return granules, []
    oldest_date = min(datetime_list)

    list_of_granules = granule_invalidator.fetch_all_granules(
        {
            "collectionId": f"{coll}___{version}",
            "timestamp__from": int(oldest_date.timestamp() * 1000),
        }
    )

    invalidating_dictionary = {
        f"{granule[begin_date_key]}_{granule[end_date_key]}": granule
        for granule in list_of_granules
        if granule.get(begin_date_key) and granule.get(end_date_key)
    }
    invalid_granules = []
    valid_granules = []
    for granule in granules:
        key = f"{granule[begin_date_key]}_{granule[end_date_key]}"
        if (
            granule.get(begin_date_key)
            and granule.get(end_date_key)
            and invalidating_dictionary.get(key) is not None
        ):
            invalid_granules.append(granule)
        else:
            valid_granules.append(granule)
    return valid_granules, invalid_granules


def identify_granules_older_than(
    granules: list[dict],
    comparison_key: str,
    comparison_key_transformation: Callable,
    expiration_time: timedelta,
) -> tuple[list[dict], list[dict]]:
    """Identify granules where datetime is older than specified age.

    Args:
        granules: A list of granules returned by the cumulus API.
        comparison_key: The key in each granule representing a datetime to compare.
        comparison_key_transformation: Function transforming datetime representation
            into a datetime object (e.g., ISO string to datetime).
        expiration_time: Timedelta representing maximum age for valid granule.

    Returns:
        Returns a list of invalid and valid granules.

    """
    expiration_threshold_datetime = datetime.now(UTC) - expiration_time
    invalid_granules = []
    valid_granules = []
    for granule in granules:
        value = granule.get(comparison_key)
        granule_datetime = comparison_key_transformation(value)
        if value is None or granule_datetime > expiration_threshold_datetime:
            valid_granules.append(granule)
        else:
            invalid_granules.append(granule)
    return valid_granules, invalid_granules
