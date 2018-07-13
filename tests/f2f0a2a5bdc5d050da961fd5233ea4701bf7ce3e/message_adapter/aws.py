""" Determines the correct AWS endpoint for AWS services """
import os
import boto3


def localhost_s3_url():
    if 'LOCALSTACK_HOST' in os.environ:
        localhost_s3_url = 'http://%s:4572' % os.environ['LOCALSTACK_HOST']
    else:
        localhost_s3_url = 'http://localhost:4572'
    return localhost_s3_url


def s3():
    """ Determines the endpoint for the S3 service """

    if ('CUMULUS_ENV' in os.environ) and (os.environ['CUMULUS_ENV'] == 'testing'):
        return boto3.resource(
            service_name='s3',
            endpoint_url=localhost_s3_url(),
            aws_access_key_id='my-id',
            aws_secret_access_key='my-secret',
            region_name='us-east-1',
            verify=False
        )
    return boto3.resource('s3')


# Localstack doesn't support step functions. This is an interim solution so we
# don't make requests to the AWS API in testing.
def stepFn():
    region = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
    if ('CUMULUS_ENV' in os.environ) and (os.environ["CUMULUS_ENV"] == 'testing'):
        return boto3.client(service_name='stepfunctions', endpoint_url=localhost_s3_url(), region_name=region)
    else:
        return boto3.client('stepfunctions', region_name=region)
