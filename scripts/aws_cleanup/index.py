import json
import os
import logging
import boto3
from datetime import datetime

from typing import TypedDict, List, Callable, Optional


logger = logging.getLogger()
logger.setLevel(os.getenv('LOG_LEVEL', 'INFO'))


class HandlerReturn(TypedDict):
    statusCode: int
    message: str


class TagObject(TypedDict):
    Key: str
    Value: str


class InstanceObject(TypedDict):
    InstanceId: str
    Tags: List[TagObject]

    
class InstancesSubObject(TypedDict):
    Instances: List[InstanceObject]


class DescribeResponse(TypedDict):
    Reservations: List[InstancesSubObject]


def should_be_cleaned_up(
    instance_object: InstanceObject,
    today_func: Callable[[], datetime] = datetime.today
) -> bool:
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
                tag['Value'].split(' ')[0],
                '%Y-%m-%d'
            )
            if rotate_date < today_func():
                return True
            return False
    logger.warning(
        f'''never found timeout key for {
            instance_object['InstanceId']
        }'''
    )
    return False


def get_instances_to_clean(
    describe_func,
    today_func: Callable[[], datetime] = datetime.today,
) -> List[str]:
    '''
    Identifies instances that should be cleaned

    Parameters:
        - describe_func: Callable, returns ec2 instance data to be examined

    Returns:
        (List[str]): list of expired ec2 instance IDs
    '''
    response = describe_func()
    instances = [
        instance
        for reservation in response['Reservations']
        for instance in reservation['Instances']
    ]
    return [
        instance['InstanceId']
        for instance in instances
        if should_be_cleaned_up(instance, today_func)
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
        to_clean = get_instances_to_clean(client.describe_instances)
        logger.info(f'attempting to clean up: {to_clean}')
        if (to_clean):
            termination = client.terminate_instances(
                InstanceIds=to_clean,
            )
            return {
                'statusCode': 200,
                'message': f'''termination completed with response {
                    json.dumps(termination)
                }''',
            }
        return {
            'statusCode': 200,
            'message': 'execution complete, no expired ec2 instances found'
        }

    except Exception as e:
        logger.error(f'Error processing order: {str(e)}')
        raise


if __name__ == '__main__':
    handler({}, {})
