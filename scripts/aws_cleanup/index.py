import json
import os
import logging
import boto3
from datetime import datetime

from typing import TypedDict, List
from mypy_boto3_ec2 import EC2Client
from mypy_boto3_ec2.type_defs import InstanceTypeDef


logger = logging.getLogger()
logger.setLevel(os.getenv('LOG_LEVEL', 'INFO'))


class HandlerReturn(TypedDict):
    statusCode: int
    message: str


class TagObject(TypedDict):
    Key: str
    Value: str


def should_be_cleaned_up(instance_object: InstanceTypeDef) -> bool:
    '''
    Identifies if an instance is expired.
    Expects ec2 instances to have a Tag which specifies its expiration date
    in '%Y-%m-%d' format. will accept further data after a space without issue
    By default this Tag is expected at the Key "Rotate By",
    but can be configured with the environment variable "timeout_key"

    Parameters:
        - instance_object (InstanceTypeDef): has Tags and InstanceId fields

    Returns:
        (bool) should this instance be cleaned up
    '''
    timeout_key = os.getenv('timeout_key', 'Rotate By')

    for tag in instance_object['Tags']:

        if tag['Key'] == timeout_key:
            rotate_date = datetime.strptime(
                tag['Key'].split(' ')[0],
                '%Y-%m-%d'
            )
            if rotate_date < datetime.today():
                return True
            return False
    logger.warning(
        f'''never found timeout key for {
            instance_object['InstanceId']
        }'''
    )
    return False


def get_instances_to_clean(client: EC2Client) -> List[str]:
    '''
    Identifies instances that should be cleaned

    Parameters:
        - client (EC2Client), implements describe_instances

    Returns:
        (List[str]): list of expired ec2 instance IDs
    '''
    response = client.describe_instances()
    instances = [
        instance
        for reservation in response['Reservations']
        for instance in reservation['Instances']
    ]
    return [
        instance['InstanceId']
        for instance in instances
        if should_be_cleaned_up(instance)
    ]


def handler(_, __) -> HandlerReturn:
    '''
    handler function
    identifies ec2 instances that need cleanup and terminates them

    Returns:
        Dict containing status message
    '''
    try:
        client = boto3.client('ec2')
        to_clean = get_instances_to_clean(client)
        logger.info(f'attempting to clean up: {to_clean}')
        termination = client.terminate_instances(
            InstanceIds=to_clean,
            DryRun=True,
        )
        return {
            'statusCode': 200,
            'message': f'''termination completed with response {
                json.dumps(termination)
            }''',
        }

    except Exception as e:
        logger.error(f'Error processing order: {str(e)}')
        raise


if __name__ == '__main__':
    handler({}, {})
