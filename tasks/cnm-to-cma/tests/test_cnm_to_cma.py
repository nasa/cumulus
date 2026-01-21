from cnm2cma.cnm_to_cma import mapper
import json
from typing import List
import pytest
import pydantic
from cnm2cma import models_cnm
from cnm2cma import models_cma_file
from cnm2cma.cnm_to_cma import  get_cnm_input_files, create_cma_files


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
            granule = mapper(data, config)
            assert(granule.get('granuleId') =='sampleGranuleName001')
            assert(granule.get('version') =='001')
            cma_files = granule.get('files')
            assert(len(cma_files) == 2)
            assert(cma_files[0].get('fileName') == "production_file.nc")
            assert(cma_files[0].get('type') == "data")
            assert(cma_files[0].get('size') == 123456)
            assert(cma_files[0].get('checksumType') == "md5")
            assert(cma_files[0].get('checksum') == "4241jafkjaj14jasjf")
            assert(cma_files[0].get('bucket') == "sampleIngestBucket")
            assert(cma_files[0].get('key') == "prod_20170926T11:30:36/production_file.nc")
            assert(cma_files[0].get('source') == "s3")

            # Use another type of assert syntax for variety
            assert cma_files[1].get('fileName') == "production_file.png"
            assert cma_files[1].get('type') == "browse"
            assert cma_files[1].get('size') == 12345
            assert cma_files[1].get('checksumType') == "md5"
            assert cma_files[1].get('checksum') == "addjd872342bfbf"
            assert cma_files[1].get('bucket') == "sampleIngestBucket"
            assert cma_files[1].get('key') == "prod_20170926T11:30:36/production_file.png"
            assert cma_files[1].get('source') == "s3"

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
            assert len(granule.get('files')) == 2
            assert granule.get('granuleId') == "JA1_GPN_2PeP001_002_20020115_060706_20020115_070316"

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
            # cnm_model = CloudNotificationMessageCnm12.parse_obj(cnm)
            cnm_files = get_cnm_input_files(cnm_model.root.product)
            assert(len(cnm_files) ==4)
            cma_files:List[models_cma_file.ModelItem]=create_cma_files(cnm_files)
            assert(len(cma_files) ==4)
            # verify every item
            assert(cma_files[0].fileName=='production_file.nc')
            assert(cma_files[0].type=='data')
            assert(cma_files[0].size==123456)
            assert(cma_files[0].checksumType=='md5')
            assert(cma_files[0].checksum=='4241jafkjaj14jasjf')
            assert(cma_files[0].bucket=='bucket_1')
            assert(cma_files[0].key=='prod_20170926T11:30:36/production_file.nc')
            assert(cma_files[0].source=='s3')

            assert(cma_files[1].fileName=='production_http_file.png')
            assert(cma_files[1].type=='browse')
            assert(cma_files[1].size==11225)
            assert(cma_files[1].checksumType=='md5')
            assert(cma_files[1].checksum=='addjd872342bfbeee')
            assert(cma_files[1].bucket=='')
            assert(cma_files[1].key=='')
            assert(cma_files[1].source=='http')

            assert(cma_files[2].fileName=='production_https_file.png')
            assert(cma_files[2].type=='browse')
            assert(cma_files[2].size==22334)
            assert(cma_files[2].checksumType.lower()=='sha256')
            assert(cma_files[2].checksum=='addjd872342bfbfjjj')
            assert(cma_files[2].bucket=='')
            assert(cma_files[2].key=='')

            assert(cma_files[3].source=='sftp')
            assert(cma_files[3].fileName=='sftp_file.nc')
            assert(cma_files[3].type=='data')
            assert(cma_files[3].size==7854321)
            assert(cma_files[3].checksumType.lower()=='sha512')
            assert(cma_files[3].checksum=='addwwmm22342bfbf')


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




