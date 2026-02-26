import json

from cma_to_cnm.cma_to_cnm import task


class TestCmaToCnm:
    def setup_method(self):
        pass

    def test_mapper(self):
        with open("tests/resources/input_multi_granule.json") as f:
            data = json.load(f)
            config = {
                "cumulus_meta": {
                    "cumulus_version": "9.9.0",
                    "message_source": "sfn",
                    "system_bucket": "dummy_bucket",
                    "state_machine": "DAACs_IngestWorkflow",
                    "execution_name": "aaaaa-bbbbb-ccccc-ddddd",
                },
                "collection": {
                    "name": "VIIRS_NPP-NAVO-L2P-v3.0",
                    "meta": {"provider_path": "/cumulus-test/gds2/NAVO/"},
                },
                "provider": {
                    "globalConnectionLimit": 1,
                    "host": "ops-metis.jpl.nasa.gov",
                    "id": "podaac-test-sftp",
                    "password": "password",
                    "protocol": "sftp",
                    "username": "cumulus-test",
                },
                "provider_path": "/cumulus-test/gds2/NAVO/",
            }
        data.get("config", {}).update(config)
        event: dict = {"config": config}
        intp_granules = data.get("payload").get("granules", [])
        event["input"] = {"granules": intp_granules}
        returned_dict = task(event, {})
        cnm_messages = returned_dict["cnm_list"]
        assert len(cnm_messages) == 3
        # 1st granule
        cnm_message = cnm_messages[0]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["version"] == "1.6.0"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert (
            cnm_message["trace"]
            == "source: DAACs_IngestWorkflow | execution_name: aaaaa-bbbbb-ccccc-ddddd"
        )
        assert (
            cnm_message["product"]["name"]
            == "20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 18167706.0
        # 2nd granule
        cnm_message = cnm_messages[1]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["version"] == "1.6.0"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert (
            cnm_message["product"]["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 18294159.0
        file = files[1]
        assert file["type"] == "metadata"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert (
            file["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert file["size"] == 97
        # 3rd granule
        cnm_message = cnm_messages[2]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert cnm_message["version"] == "1.6.0"
        assert (
            cnm_message["product"]["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 17146221
        file = files[1]
        assert file["type"] == "metadata"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert (
            file["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert file["size"] == 97

    def test_mapper_with_input_identifier(self):
        with open("tests/resources/input_multi_granule.json") as f:
            data = json.load(f)
            config = {
                "identifier": "test_identifier_value",
                "cumulus_meta": {
                    "cumulus_version": "9.9.0",
                    "message_source": "sfn",
                    "system_bucket": "dummy_bucket",
                    "state_machine": "DAACs_IngestWorkflow",
                    "execution_name": "aaaaa-bbbbb-ccccc-ddddd",
                },
                "collection": {
                    "name": "VIIRS_NPP-NAVO-L2P-v3.0",
                    "meta": {"provider_path": "/cumulus-test/gds2/NAVO/"},
                },
                "provider": {
                    "globalConnectionLimit": 1,
                    "host": "ops-metis.jpl.nasa.gov",
                    "id": "podaac-test-sftp",
                    "password": "password",
                    "protocol": "sftp",
                    "username": "cumulus-test",
                },
                "provider_path": "/cumulus-test/gds2/NAVO/",
            }
        data.get("config", {}).update(config)
        event: dict = {"config": config}
        intp_granules = data.get("payload").get("granules", [])
        event["input"] = {"granules": intp_granules}
        returned_dict = task(event, {})
        cnm_messages = returned_dict["cnm_list"]
        assert len(cnm_messages) == 3
        # 1st granule
        cnm_message = cnm_messages[0]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["version"] == "1.6.0"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert (
            cnm_message["trace"]
            == "source: DAACs_IngestWorkflow | execution_name: aaaaa-bbbbb-ccccc-ddddd"
        )
        assert (
            cnm_message["product"]["name"]
            == "20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135009-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 18167706.0
        # 2nd granule
        cnm_message = cnm_messages[1]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["version"] == "1.6.0"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert (
            cnm_message["product"]["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 18294159.0
        file = files[1]
        assert file["type"] == "metadata"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert (
            file["name"]
            == "20220111135133-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert file["size"] == 97
        # 3rd granule
        cnm_message = cnm_messages[2]
        assert cnm_message["provider"] == "podaac-test-sftp"
        assert cnm_message["collection"] == "VIIRS_NPP-NAVO-L2P-v3.0"
        assert cnm_message["version"] == "1.6.0"
        assert (
            cnm_message["product"]["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0"
        )
        assert cnm_message["product"]["producerGranuleId"] == ""
        assert cnm_message["product"]["dataVersion"] == "3.0"
        files = cnm_message["product"]["files"]
        assert len(files) == 2
        file = files[0]
        assert file["type"] == "data"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert (
            file["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc"
        )
        assert file["size"] == 17146221
        file = files[1]
        assert file["type"] == "metadata"
        assert (
            file["uri"]
            == "sftp://ops-metis.jpl.nasa.gov/cumulus-test/gds2/NAVO/20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert (
            file["name"]
            == "20220111135258-NAVO-L2P_GHRSST-SST1m-VIIRS_NPP-v02.0-fv03.0.nc.md5"
        )
        assert file["size"] == 97
