"""Task for archiving PDRs."""

import json
import logging
import os
from datetime import datetime

import boto3
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

logger = CumulusLogger('pdr-cleanup', logging.INFO)

def cleanup_pdr(event: dict, context: dict):
    """Task to archive PDRs.

    Args:
        event (dict): A lambda event object
        context (dict): An AWS Lambda context

    """

    logger.info('## EVENT OBJ \n' + json.dumps(event))

    provider = event['config']['provider']
    pdr = event['input']['pdr']

    if (len(event['input']['failed']) == 0):
        move_pdr(provider, pdr)
    else:
        logger.info("PDR failed to ingest all granules successfully, NOT archiving")
        raise Exception(
            "PDR failed to ingest all granules successfully\n"
            f"Ingest Granule workflow failure count: {len(event['input']['failed'])}")
    return event['input']

def move_pdr(provider: dict, pdr: dict):
    """Move PDR to location <provider.host>/<PDRs>/ .

    Args:
        provider (dict): Provider information
        pdr (dict): PDR information

    """

    curr_date = datetime.now().strftime('%Y.%m.%d')
    src_path = os.path.join(pdr['path'], pdr['name'])
    dest_path = os.path.join('PDRs', pdr['path'], curr_date, pdr['name'])

    s3_client = boto3.client('s3')
    try:
        s3_client.copy_object(
            CopySource=os.path.join(provider['host'], src_path),
            Bucket=provider['host'],
            Key=dest_path
        )
        logger.info(
            f'COPIED FROM {provider["host"]}/{src_path} '
            f'TO {provider["host"]}/{dest_path}')
    except Exception:
        logger.error(
            f'FAILED TO COPY FROM {provider["host"]}/{src_path} '
            f'TO {provider["host"]}/{dest_path}')
        raise

    try:
        s3_client.delete_object(Bucket=provider['host'], Key=src_path)
        logger.info(f'DELETED: {provider["host"]}/{src_path}')
    except Exception as err:
        logger.error(err)
        raise

def handler(event: dict, context: dict):
    """Lambda handler that runs the task through CMA.

    Args:
        event (dict): A Cumulus Message
        context (dict): An AWS Lambda context

    Returns:
        Returns output from task.

    """

    return run_cumulus_task(cleanup_pdr, event, context)