import os
from datetime import datetime
from index import should_be_cleaned_up, get_instances_to_clean


def test_should_be_cleaned_up_false_on_unexpired():
    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [{'Key': 'Rotate By', 'Value': '2022-02-03'}]
            },
            lambda: datetime(2022, 2, 1),
        )
        is False
    )

    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [
                    {'Key': 'Wiggly', 'Value': '2022-01-03'},
                    {'Key': 'Rotate By', 'Value': '2022-02-03'},
                ],
            },
            lambda: datetime(2022, 2, 1),
        )
        is False
    )


def test_should_be_cleaned_up_true_on_expired():
    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [{'Key': 'Rotate By', 'Value': '2022-01-03'}]
            },
            lambda: datetime(2022, 2, 1),
        )
        is True
    )

    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [
                    {'Key': 'Wiggly', 'Value': '2022-02-03'},
                    {'Key': 'Rotate By', 'Value': '2022-01-03'},
                ],
            },
            lambda: datetime(2022, 2, 1),
        )
        is True
    )


def test_should_be_cleaned_up_respects_env_variable():
    env = {**os.environ}
    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [{'Key': 'Rotate By', 'Value': '2022-01-03'}]
            },
            lambda: datetime(2022, 2, 1),
        )
        is True
    )
    assert (
        should_be_cleaned_up(
            {'Tags': [{'Key': 'Rotate By', 'Value': '2022-03-03'}]},
            lambda: datetime(2022, 2, 1),
        )
        is False
    )
    os.environ['timeout_key'] = 'Wiggly'
    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [
                    {'Key': 'Rotate By', 'Value': '2022-03-03'},
                    {'Key': 'Wiggly', 'Value': '2022-01-03'},
                ],
            },
            lambda: datetime(2022, 2, 1),
        )
        is True
    )
    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [
                    {'Key': 'Rotate By', 'Value': '2022-01-03'},
                    {'Key': 'Wiggly', 'Value': '2022-03-03'},
                ],
            },
            lambda: datetime(2022, 2, 1),
        )
        is False
    )
    os.environ = env


def test_should_be_cleaned_up_false_on_tag_not_found():
    assert (
        should_be_cleaned_up(
            {'InstanceId': 'a', 'Tags': []},
        )
        is False
    )

    assert (
        should_be_cleaned_up(
            {
                'InstanceId': 'a',
                'Tags': [{'Key': 'Something', 'Value': 'Else'}]
            },
        )
        is False
    )


def test_get_instances_to_clean():
    assert get_instances_to_clean(
        lambda: {
            'Reservations': [
                {
                    'Instances': [
                        {
                            'InstanceId': 'abc',
                            'Tags': [
                                {
                                    'Key': 'Rotate By',
                                    'Value': '2022-01-02'
                                }
                            ],
                        }
                    ]
                }
            ]
        },
        lambda: datetime(2022, 1, 3),
    ) == ['abc']

    assert get_instances_to_clean(
        lambda: {
            'Reservations': [
                {
                    'Instances': [
                        {
                            'InstanceId': '1',
                            'Tags': [
                                {
                                    'Key': 'Rotate By',
                                    'Value': '2022-01-02'
                                }
                            ],
                        },
                        {
                            'InstanceId': '2',
                            'Tags': [
                                {
                                    'Key': 'Rotate By',
                                    'Value': '2022-02-02'
                                }
                            ],
                        },
                    ]
                }
            ]
        },
        lambda: datetime(2022, 1, 3),
    ) == ['1']
