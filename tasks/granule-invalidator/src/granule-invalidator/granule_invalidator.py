#!/usr/bin/env python

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Tuple

from cumulus_api import CumulusApi
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

import invalidations

LOGGER = CumulusLogger(__name__, level=int(os.environ.get('LOGLEVEL', logging.DEBUG)))
MAX_GRANULES_FETCHED = 100000
schemas = {'config': 'schemas/config_schema.json'}

EVENT_TYPING = Dict[Any, Any]


def lambda_handler(event: EVENT_TYPING, context: Any) -> Any:
    """
    Lambda handler.  Context - the second argument - is unused.
    """

    # This is a function that AWS will call when we invoke the lambda
    LOGGER.setMetadata(event, context)
    cumulus_task_return = run_cumulus_task(lambda_adapter, event, context, schemas)
    return cumulus_task_return


def lambda_adapter(event: EVENT_TYPING, _: Any) -> Dict[str, Any]:
    """
    Lambda adapter function to handle granule invalidation.

    Args:
        event (EVENT_TYPING): The event containing configuration details with the following
            keys:
            - collection (str): The collection shortname to apply invalidations to.
            - version (str): The version of the collection to apply invalidations to.
            - granule_invalidations (list): Array of invalidation criteria objects.
            - page_length_ms (int, optional): Time window in milliseconds for pagination
              when fetching granules. Defaults to 7 days (604800000 milliseconds). This
              parameter controls how granules are batched during retrieval based on their
              updatedAt timestamp.
        _ (Any): Unused context argument.

    Returns:
        Dict[str, Any]: Returns a dictionary containing granules to invalidate and statistics.
    """
    config = event.get('config', {})
    granule_invalidations = config.get('granule_invalidations')
    collection = config.get('collection')
    version = config.get('version')
    page_length_ms = config.get(
        'page_length_ms', 7 * 24 * 60 * 60 * 1000
    )  # default to one week in milliseconds

    list_of_granules = fetch_all_granules(
        {'collectionId': f'{collection}___{version}'}, page_length_ms
    )
    valid_granules = list_of_granules
    invalid_granules = []
    aggregated_stats = {}
    for granule_invalidation in granule_invalidations:
        if not valid_granules:
            LOGGER.info('No valid granules remaining, returning')
            break
        valid_granules, invalid_granules_this_run = run_invalidation(
            valid_granules, granule_invalidation
        )
        aggregated_stats[granule_invalidation.get('type')] = len(invalid_granules_this_run)
        invalid_granules.extend(invalid_granules_this_run)
        LOGGER.info(
            f'Invalidated {len(invalid_granules_this_run)} granules out of '
            f'{len(valid_granules) + len(invalid_granules)} granules '
            f'after running {granule_invalidation.get("type")} invalidation'
        )
        LOGGER.info(
            f'Type of invalidation: {granule_invalidation.get("type")} '
            f'Granule IDs: {[granule["granuleId"] for granule in invalid_granules_this_run]}'
        )
    LOGGER.info(
        f'Invalidated a total of {len(invalid_granules)} granules '
        f'out of {len(valid_granules) + len(invalid_granules)} granules'
    )

    granules_to_be_removed_by_invalidation_type = '\n'.join(
        [
            f'{invalidation_type} - {invalidation_count} granules'
            for invalidation_type, invalidation_count in aggregated_stats.items()
        ]
    )

    return {
        'granules': [
            {'granuleId': invalid_granule['granuleId'], 'collectionId': f'{collection}___{version}'}
            for invalid_granule in invalid_granules
        ],
        'forceRemoveFromCmr': True,
        'granules_to_be_deleted_count': len(invalid_granules),
        'aggregated_stats': (
            f'Total number of granules to be removed: {len(invalid_granules)}\n'
            f'Total number of granules to be retained: {len(valid_granules)}\n'
            f'Granules to be removed by invalidation type:\n'
            f'{granules_to_be_removed_by_invalidation_type}\n'
        ),
    }


def run_invalidation(
    granules: List[Dict], granule_invalidation: Dict
) -> Tuple[List[Dict], List[Dict]]:
    """
    This maps a granule invalidation to the corresponding function and calls the invalidation
    function.

    Args:
        granules: A list of granules returned by the cumulus API.
        granule_invalidation: Information about the granule invalidation containing, at minimum,
        the "type" key.

    Returns:
        Returns a list of invalid and valid granules.
    """
    try:
        invalidation_function = getattr(invalidations, granule_invalidation.get('type'))
    except AttributeError:
        raise ValueError(
            f'Invalid type {granule_invalidation.get("type")} for granule invalidation'
        )

    return invalidation_function(granules, granule_invalidation)


async def _fetch_single_page(
    cml: CumulusApi,
    args: Dict,
    page: int,
    granule_count: int,
    semaphore: asyncio.Semaphore,
) -> List[Dict]:
    """
    Fetch a single page with semaphore protection.

    Args:
        cml: CumulusApi instance
        args: Arguments to pass to list_granules
        page: Page number to fetch
        granule_count: Total granule count for logging
        semaphore: Asyncio semaphore to limit concurrent requests

    Returns:
        List of granules from the fetched page
    """
    async with semaphore:
        args_with_page = {**args, 'page': page}
        LOGGER.debug(f'Fetching page {page} with args {args_with_page}')
        grans = await asyncio.to_thread(lambda: cml.list_granules(**args_with_page))
        results = grans.get('results', [])
        LOGGER.debug(f'Fetched {len(results)} granules of {granule_count}')
        return results


async def list_all_granules(**args) -> List[Dict]:
    """
    This is a helper function to list all granules from Cumulus for a specific collection and
        version.

    Args:
        args: The arguments to pass to list_granules.  This will typically always include
        collectionId and may include other args to filter the output.

    Returns:
        A list of granules from Cumulus.
    """
    cml = CumulusApi()
    grans = cml.list_granules(**args, **{'countOnly': 'true'})
    granule_count = grans.get('meta', {}).get('count', 0)
    page_limit = grans.get('meta', {}).get('limit', 100)
    if granule_count == 0:
        LOGGER.debug(f'No granules found with {args}')
        return []

    granules_fetched = []
    pages = (granule_count // page_limit) + 1

    semaphore = asyncio.Semaphore(50)
    tasks = [
        _fetch_single_page(cml, args, page, granule_count, semaphore)
        for page in range(1, pages + 1)
    ]
    page_results = await asyncio.gather(*tasks)

    for results in page_results:
        granules_fetched.extend(results)

    return granules_fetched


def fetch_all_granules(args: Dict, page_length_ms: int = 7 * 24 * 60 * 60 * 1000) -> List[Dict]:
    """
    This retrieves all granules from Cumulus for a specific collection and version.

    Args:
        args: The arguments to pass to list_granules.  This will typically always include
        collectionId and may include other args to filter the output.
        page_length_ms (int): Time window in milliseconds for pagination. Defaults to 7 days
        (604800000 milliseconds). Granules are fetched in batches based on their updatedAt
        timestamp within each time window.

    Returns:
        A list of granules from Cumulus.
    """
    cml = CumulusApi()
    grans = cml.list_granules(**args, **{'countOnly': 'true'})
    granule_count = min(grans.get('meta', {}).get('count', 0), MAX_GRANULES_FETCHED)

    start_time = int(time.time() * 1000)
    end_time = 0

    updated_at_time_list = range(start_time, end_time, -page_length_ms)

    results = []
    for updated_at_to in updated_at_time_list:
        start_timer = time.time()
        start = updated_at_to
        end = updated_at_to - page_length_ms
        full_arg_list = {
            **args,
            **{
                'limit': 100,
                'updatedAt__to': start,
                'updatedAt__from': end,
                'sort_key[]': '-timestamp',
            },
        }
        granules = asyncio.run(list_all_granules(**full_arg_list))
        results.extend(granules)
        returned_granule_count = len(results)
        LOGGER.debug(
            f'Fetched {len(granules)} granules in this batch, total so far: '
            f'{returned_granule_count}, waiting for: {granule_count}'
        )
        seconds = time.time() - start_timer
        LOGGER.debug(
            f'Done with interval {datetime.fromtimestamp(start / 1000).isoformat()} - '
            f'{datetime.fromtimestamp(end / 1000).isoformat()} in {seconds:.1f} seconds, '
            f'{len(granules)} granules, args {full_arg_list}'
        )
        if returned_granule_count >= granule_count:
            LOGGER.info(
                f'Fetched all requested granules ({returned_granule_count} found, '
                f'{granule_count} expected), breaking'
            )
            break
    return results


if __name__ == '__main__':
    lambda_adapter(
        {
            'config': {
                'granule_invalidations': [
                    {'type': 'science_date', 'maximum_minutes_old': 1000000},
                    {'type': 'ingest_date', 'maximum_minutes_old': 1},
                    {
                        'type': 'cross_collection',
                        'invalidating_collection': 'ATL09',
                        'invalidating_version': '006',
                    },
                ],
                'collection': 'ATL08',
                'version': '006',
            }
        },
        None,
    )