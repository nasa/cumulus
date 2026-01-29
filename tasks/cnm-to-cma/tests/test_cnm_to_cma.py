from cnm2cma.cnm_to_cma import mapper
import json
from typing import List
import pytest
import pydantic
from cnm2cma import models_cnm
from cnm2cma import models_granule
from cnm2cma.cnm_to_cma import  get_cnm_input_files, create_granule_files


class TestCNMToCMA:
    def setup_method(self):
        pass

    def test_mapper(self):
        with open(
            "tests/resources/cumulus_sns_v1.0_notification.json", "r"
        ) as f:
            data = json.load(f)
            config = {
                "collection": {
                    "name": "test_collection",
                    "version": "001",
                    "granuleIdExtraction": None,
                }
            }
            granule:models_granule.Granule = mapper(data, config)
            assert(granule.granuleId =='sampleGranuleName001')
            assert granule.producerGranuleId == "producerGranuleId_from_data_provider"
            assert(granule.version =='001')
            granule_files:List[models_granule.File] = granule.files
            assert(len(granule_files) == 2)
            assert granule_files[0].name == "production_file.nc"
            assert granule_files[0].filename == "production_file.nc"
            assert granule_files[0].type == "data"
            assert granule_files[0].source_bucket == "sampleIngestBucket"
            assert granule_files[0].path == "prod_20170926T11:30:36/production_file.nc"

            # Use another type of assert syntax for variety
            assert granule_files[1].name == "production_file.png"
            assert granule_files[1].filename == "production_file.png"
            assert granule_files[1].type == "browse"
            assert granule_files[1].source_bucket == "sampleIngestBucket"
            assert granule_files[1].path == "prod_20170926T11:30:36/production_file.png"

    def test_granule_extraction(self):
        with open(
            "tests/resources/cumulus_sns_v1.0_JA1_GPN_E.json", "r"
        ) as f:
            data = json.load(f)
            config = {
                "collection": {
                    "name": "test_collection",
                    "version": "001",
                    "granuleIdExtraction": "^(JA1_GPN_2PeP([0-9]{3})_([0-9]{3})_([0-9]{8})_([0-9]{6})_([0-9]{8})_([0-9]{6}))((\\.nc)|(\\.cmr\\.json))?$"
                }
            }
            # 'JA1_GPN_2PeP001_002_20020115_060706_20020115_070316'
            granule = mapper(data, config)
            assert len(granule.files) == 2
            assert granule.granuleId == "JA1_GPN_2PeP001_002_20020115_060706_20020115_070316"

    def test_mapper_with_wrong_formatted_json(self):
        with open(
            "tests/resources/cumulus_sns_v1.0_notification_incorrect_formatted.json", "r"
        ) as f:
            data = json.load(f)
            with pytest.raises(pydantic.ValidationError):
                config = {}
                mapper(data, config)

    def test_build_granule_file(self):
        """
        This test case is using a input file which is nearly impossible to happen
        i.e.. the sns file containing data source from different protodols -
        s3, https, sftp in one single notification message.
        """
        with open(
            "tests/resources/cumulus_sns_v1.0_notification_multi_protocols.json", "r"
        ) as f:
            cnm = json.load(f)
            cnm_model = models_cnm.CloudNotificationMessageCnm12.model_validate(cnm)
            cnm_files = get_cnm_input_files(cnm_model.root.product)
            assert(len(cnm_files) ==4)
            granule_files:List[models_granule.File]=create_granule_files(cnm_files)
            assert(len(granule_files) ==4)
            # verify every item
            assert(granule_files[0].name=='production_file.nc')
            assert(granule_files[0].filename=='production_file.nc')
            assert(granule_files[0].type=='data')
            assert(granule_files[0].source_bucket=='bucket_1')
            assert(granule_files[0].path=='prod_20170926T11:30:36/production_file.nc')

            assert granule_files[1].name == "production_http_file.png"
            assert granule_files[1].filename == "production_http_file.png"
            assert granule_files[1].type == "browse"
            assert granule_files[1].source_bucket == None
            assert granule_files[1].path == "http/path"

            assert granule_files[2].name == "production_https_file.png"
            assert granule_files[2].filename == "production_https_file.png"
            assert granule_files[2].type == "browse"
            assert granule_files[2].source_bucket == None
            assert granule_files[2].path == "http/path"

            assert granule_files[3].name == "sftp_file.nc"
            assert granule_files[3].filename == "sftp_file.nc"
            assert granule_files[3].type == "data"
            assert granule_files[3].source_bucket == None
            assert granule_files[3].path == "sftp_path"


    def test_get_cnm_input_files(self):
        with open(
            "tests/resources/cumulus_sns_v1.1_filegroups_multiple.json", "r"
        ) as f:
            cnm = json.load(f)
            cnm_model = models_cnm.CloudNotificationMessageCnm12.model_validate(cnm)
            cnm_files = get_cnm_input_files(cnm_model.root.product)
            print('get_cnm_input_files was called')
            assert(len(cnm_files) == 4)
            # verify the 1st and 3rd item
            fist_cnm_file:models_cnm.File = cnm_files[0]
            assert(fist_cnm_file.uri =='s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.nc')
            assert(fist_cnm_file.type==models_cnm.Type.data)
            assert(fist_cnm_file.name == "production_file.nc")
            assert(fist_cnm_file.checksumType == models_cnm.ChecksumType.md5)
            assert(fist_cnm_file.checksum == "4241jafkjaj14jasjf")
            assert(fist_cnm_file.size == 123456)
            forth_cnm_file = cnm_files[3]
            assert(forth_cnm_file.uri =='s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.png')
            assert(forth_cnm_file.type==models_cnm.Type.browse)
            assert(forth_cnm_file.name == "production_file.png")
            assert(forth_cnm_file.checksumType == models_cnm.ChecksumType.md5)
            assert(forth_cnm_file.checksum == "addjd872342bfbf")
            assert(forth_cnm_file.size == 12345)
