from cnm2cma.cnm_to_cma import mapper
import json
from typing import List
import pytest
import pydantic
# from cnm2cma.models_cnm import CloudNotificationMessageCnm12, File, Type, ChecksumType
from cnm2cma import models_cnm
from cnm2cma.cnm_to_cma import mapper, get_cnm_input_files


class TestCNMToCMA:
    def setup_method(self):
        pass

    def test_mapper(self):
        with open(
            "tests/resources/cumulus_sns_v1.1_filegroups_multiple.json", "r"
        ) as f:
            data = json.load(f)
            mapper(data)

            filegroups: List = data["product"]["filegroups"]
            assert len(filegroups) == 2
            assert len(filegroups[0]["files"]) == 2
            input_files = self.cnm2cma.get_input_files(data.get("product"))
            print(input_files)
            assert len(input_files) == 4
            file = input_files[3]
            assert (
                file["uri"]
                == "s3://sampleIngestBucket/prod_20170926T11:30:36/production_file.png"
            )



    def test_mapper_with_wrong_formatted_json(self):
        with open(
            "tests/resources/cumulus_sns_v1.0_notification_incorrect_formatted.json", "r"
        ) as f:
            data = json.load(f)
            with pytest.raises(pydantic.ValidationError):
                mapper(data)

    def test_build_granule_file(self):
        with open(
            "tests/resources/cumulus_sns_v1.1_filegroups_multiple.json", "r"
        ) as f:
            cnm = json.load(f)
            cnm_model = models_cnm.CloudNotificationMessageCnm12.model_validate(cnm)
            # cnm_model = CloudNotificationMessageCnm12.parse_obj(cnm)
            cnm_files = get_cnm_input_files(cnm_model.root.product)
            cnm_file:models_cnm.File = cnm_files[0]
            cma_file = mapper.build_granule_file(cnm_file, 's3')
            assert(cma_file.name == "production_file.nc")
            assert(cma_file.size == 123456)
            assert(cma_file.type == models_cnm.Type.data)
            assert(cma_file.fileName == "production_file.nc")
            assert(cma_file.checksum == "4241jafkjaj14jasjf")
            assert(cma_file.checksumType == models_cnm.ChecksumType.md5)
            assert(cma_file.source == "s3")
            assert(cma_file.bucket == "sampleIngestBucket")
            assert(cma_file.key == "prod_20170926T11:30:36/production_file.nc")


    def test_get_cnm_input_files(self):
        with open(
            "tests/resources/cumulus_sns_v1.1_filegroups_multiple.json", "r"
        ) as f:
            cnm = json.load(f)
            cnm_model = models_cnm.CloudNotificationMessageCnm12.model_validate(cnm)
            # cnm_model = CloudNotificationMessageCnm12.parse_obj(cnm)
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




