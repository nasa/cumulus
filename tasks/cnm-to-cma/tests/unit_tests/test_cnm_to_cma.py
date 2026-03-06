import json

import pytest

from cnm_to_cma.cnm_to_cma import create_granule_files, get_cnm_input_files, mapper


def test_mapper(data_path):
    with (data_path / "cumulus_sns_v1.0_notification.json").open() as f:
        data = json.load(f)

    config = {
        "collection": {
            "name": "test_collection",
            "version": "001",
            "granuleIdExtraction": None,
        },
    }
    granule = mapper(data, config)

    assert granule == {
        "granuleId": "sampleGranuleName001",
        "producerGranuleId": "producerGranuleId_from_data_provider",
        "dataType": "test_collection",
        "version": "001",
        "files": [
            {
                "name": "production_file.nc",
                "filename": "production_file.nc",
                "type": "data",
                "source_bucket": "sampleIngestBucket",
                "path": "prod_20170926T11:30:36",
            },
            {
                "name": "production_file.png",
                "filename": "production_file.png",
                "type": "browse",
                "source_bucket": "sampleIngestBucket",
                "path": "prod_20170926T11:30:36",
            },
        ],
    }


def test_mapper_granule_id_extraction(data_path):
    with (data_path / "cumulus_sns_v1.0_JA1_GPN_E.json").open() as f:
        data = json.load(f)

    config = {
        "collection": {
            "name": "test_collection",
            "version": "001",
            "granuleIdExtraction": "^(JA1_GPN_2PeP([0-9]{3})_([0-9]{3})_([0-9]{8})_([0-9]{6})"
            "_([0-9]{8})_([0-9]{6}))((\\.nc)|(\\.cmr\\.json))?$",
        },
    }
    # 'JA1_GPN_2PeP001_002_20020115_060706_20020115_070316'
    granule = mapper(data, config)

    assert granule["granuleId"] == "JA1_GPN_2PeP001_002_20020115_060706_20020115_070316"
    assert len(granule["files"]) == 2


def test_mapper_with_empty_uri(data_path):
    with (data_path / "cumulus_sns_v1.0_notification_empty_uri.json").open() as f:
        data = json.load(f)

    with pytest.raises(ValueError):
        mapper(data, config={})


def test_mapper_with_unsupported_protocol(data_path):
    with (
        data_path / "cumulus_sns_v1.0_notification_unsupported_protocols.json"
    ).open() as f:
        data = json.load(f)

    with pytest.raises(ValueError, match="Unsupported protocol: as4"):
        mapper(data, config={})


def test_get_cnm_input_files(data_path):
    with (data_path / "cumulus_sns_v1.1_filegroups_multiple.json").open() as f:
        cnm = json.load(f)

    cnm_files = get_cnm_input_files(cnm["product"])

    assert cnm_files == [
        {
            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file1.nc",
            "name": "production_file1.nc",
            "type": "data",
            "checksum": "4241jafkjaj14jasjf",
            "checksumType": "md5",
            "size": 123456,
        },
        {
            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file1.png",
            "name": "production_file1.png",
            "type": "browse",
            "checksum": "addjd872342bfbf",
            "checksumType": "md5",
            "size": 12345,
        },
        {
            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file2.nc",
            "name": "production_file2.nc",
            "type": "data",
            "checksum": "54241jafkjaj14jasjf",
            "checksumType": "md5",
            "size": 223456,
        },
        {
            "uri": "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file2.png",
            "name": "production_file2.png",
            "type": "browse",
            "checksum": "aaddjd872342bfbf",
            "checksumType": "md5",
            "size": 22345,
        },
    ]


def test_create_granule_files(data_path):
    """Test case is using a input file which is nearly impossible to happen
    i.e.. the sns file containing data source from different protocols -
    s3, https, sftp in one single notification message.
    """
    with (data_path / "cumulus_sns_v1.0_notification_multi_protocols.json").open() as f:
        cnm = json.load(f)

    cnm_files = get_cnm_input_files(cnm["product"])

    granule_files = create_granule_files(cnm_files)
    assert granule_files == [
        {
            "name": "production_file.nc",
            "filename": "production_file.nc",
            "type": "data",
            "source_bucket": "bucket_1",
            "path": "prod_20170926T11:30:36",
        },
        {
            "name": "production_http_file.png",
            "filename": "production_http_file.png",
            "type": "browse",
            "source_bucket": None,
            "path": "http/path",
        },
        {
            "name": "production_https_file.png",
            "filename": "production_https_file.png",
            "type": "browse",
            "source_bucket": None,
            "path": "http/path",
        },
        {
            "name": "sftp_file.nc",
            "filename": "sftp_file.nc",
            "type": "data",
            "source_bucket": None,
            "path": "sftp_path",
        },
    ]
