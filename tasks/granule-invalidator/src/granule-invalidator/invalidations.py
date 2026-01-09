import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Tuple

from cumulus_logger import CumulusLogger

import granule_invalidator

LOGGER = CumulusLogger(__name__, level=int(os.environ.get('LOGLEVEL', logging.DEBUG)))


def science_date(
    granules: List[Dict], granule_invalidation_information: Dict
) -> Tuple[List[Dict], List[Dict]]:
    """
    This identifies granules that are older than a specified age based on a productionDateTime in
    the granule.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation containing, at
         minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.
    """
    expiration_timedelta = timedelta(
        minutes=granule_invalidation_information.get('maximum_minutes_old')
    )
    comparison_key = 'productionDateTime'

    def comparison_key_transformation(datetime_representation):
        return datetime.fromisoformat(datetime_representation)

    return identify_granules_older_than(
        granules, comparison_key, comparison_key_transformation, expiration_timedelta
    )


def ingest_date(
    granules: List[Dict], granule_invalidation_information: Dict
) -> Tuple[List[Dict], List[Dict]]:
    """
    This identifies granules that are older than a specified age based on a createdAt datetime in
    the granule.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation containing, at
        minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.
    """
    expiration_timedelta = timedelta(
        minutes=granule_invalidation_information.get('maximum_minutes_old')
    )
    comparison_key = 'createdAt'

    def comparison_key_transformation(datetime_representation):
        return datetime.fromtimestamp(datetime_representation / 1000, timezone.utc)

    return identify_granules_older_than(
        granules, comparison_key, comparison_key_transformation, expiration_timedelta
    )


def cross_collection(
    granules: List[Dict], granule_invalidation_information: Dict
) -> Tuple[List[Dict], List[Dict]]:
    """
    This identifies granules that are superseded by the presence of granules in another collection,
      represented by identical productionDateTime values in both collections.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation_information: Information about the granule invalidation containing,
          at minimum, the "type" key.

    Returns:
        Returns a list of invalid and valid granules.
    """
    granule_invalidation_coll = granule_invalidation_information.get('invalidating_collection')
    granule_invalidation_version = granule_invalidation_information.get('invalidating_version')
    begin_date_key = 'beginningDateTime'
    end_date_key = 'endingDateTime'
    # Identify the oldest date that we're interested in so we can filter on granules that are
    # newer than that
    datetime_list = [
        datetime.fromisoformat(granule[begin_date_key])
        for granule in granules
        if granule.get(begin_date_key)
    ]
    if not datetime_list:
        LOGGER.info(
            'No granules with valid beginningDateTime found, '
            'skipping cross collection invalidation'
        )
        return granules, []
    oldest_date = min(datetime_list)

    list_of_granules = granule_invalidator.fetch_all_granules(
        {
            'collectionId': f'{granule_invalidation_coll}___{granule_invalidation_version}',
            'timestamp__from': int(oldest_date.timestamp() * 1000),
        }
    )

    invalidating_dictionary = {
        f'{granule[begin_date_key]}_{granule[end_date_key]}': granule
        for granule in list_of_granules
        if granule.get(begin_date_key) and granule.get(end_date_key)
    }
    invalid_granules = []
    valid_granules = []
    for granule in granules:
        if (
            granule.get(begin_date_key)
            and granule.get(end_date_key)
            and invalidating_dictionary.get(f'{granule[begin_date_key]}_{granule[end_date_key]}')
            is not None
        ):
            invalid_granules.append(granule)
        else:
            valid_granules.append(granule)
    return valid_granules, invalid_granules


def identify_granules_older_than(
    granules: List[Dict],
    comparison_key: str,
    comparison_key_transformation: Callable,
    expiration_time: timedelta,
) -> Tuple[List[Dict], List[Dict]]:
    """
    This identifies granules in a list where a datetime in the granule is older than a specified
    age.

    Args:
        granules: A list of granules returned by the cumulus API.
        comparison_key: The key to inspect in each granule that represents a datetime to be
        compared
        comparison_key_transformation: A function that transforms the datetime representation into
        a datetime object (eg if `comparison_key` represents an ISO string)
        expiration_time: A timedelta representing the maximum age of a granule to be considered
        valid.

    Returns:
        Returns a list of invalid and valid granules.
    """
    expiration_threshold_datetime = datetime.now(timezone.utc) - expiration_time
    invalid_granules = []
    valid_granules = []
    for granule in granules:
        value = granule.get(comparison_key)
        if value is None or comparison_key_transformation(value) > expiration_threshold_datetime:
            valid_granules.append(granule)
        else:
            invalid_granules.append(granule)
    return valid_granules, invalid_granules