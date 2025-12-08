"""lambda function used to translate CNM messages to CMA messages in aws lambda with cumulus"""

import os
import re
from datetime import datetime, timezone
from typing import List
from cumulus_logger import CumulusLogger
from cumulus_process import Process

REGION = os.environ.get("REGION", "us-west-2")
cumulus_logger = CumulusLogger("cnm2cma")


class CNM2CMA(Process):
    """
    Message transformation class to transform CNM to CMA

    Attributes
    ----------
    logger: logger
        cumulus logger
    config: dictionary
        configuration from cumulus
    """

    def __init__(self, *args, **kwargs):
        """class init function"""

        # super().__init__(*args, **kwargs)
        super(CNM2CMA, self).__init__(*args, **kwargs)
        self.logger = cumulus_logger

    def process(self):
        """Main process to transform cnm to cma

        Return
        ----------
        dict
            Payload that is returned as the cma which is a dictionary with list of granules
        """
        # This is the payload
        cnm = self.input
        # This is the config
        config = self.config
        self.logger.info(f"cnm2cma object: {cnm}")
        self.logger.info(f"config object: {config}")

        granule_id_extraction = config.get("collection").get("granuleIdExtraction")
        granule_id = cnm.get("product").get("name", "")
        self.logger.info(f"extracted granule_id: {granule_id}")
        if "/" in granule_id:
            granule_id = granule_id[granule_id.index("/") + 1 :]
        matcher = re.search(granule_id_extraction, granule_id)
        if matcher:
            granule_id = matcher.group(1)
        product = cnm["product"]
        # extract files or filegroups from product
        input_files = self.get_input_files(product)
        files = self.get_files(input_files)
        self.logger.info(f"files: {files}")

        granule = {
            "granuleId": granule_id,
            "version": config.get("collection", {}).get("version"),
            "dataType": config.get("collection", {}).get("name"),
            "files": files,
        }
        granule_array = [granule]
        now_as_iso = (
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        )
        cnm["receivedTime"] = now_as_iso

        output = {"cnm": cnm, "output_granules": {"granules": granule_array}}
        return output

    def get_files(self, input_files: List) -> List:
        files = []
        for cnm_file in input_files:
            uri = cnm_file.get("uri", "").strip()
            if uri.lower().startswith("s3://"):
                granule_file = self.build_s3_granule_file(cnm_file)
            elif uri.lower().startswith("https://") or uri.lower().startswith(
                "http://"
            ):
                granule_file = self.build_https_granule_file(cnm_file)
            elif uri.lower().startswith("sftp://"):
                granule_file = self.build_sftp_granule_file(cnm_file)
            else:
                granule_file = None
            if granule_file:
                files.append(granule_file)
        return files

    def get_input_files(self, product):
        input_files = product.get("files")
        if input_files is None:
            input_files = []
            filegroups = product.get("filegroups", [])
            for fg in filegroups:
                input_files.extend(fg.get("files", []))
        return input_files

    def build_s3_granule_file(self, cnm_file):
        uri = cnm_file.get("uri", "").strip()
        # Logging can be added if needed: logging.info(f"uri: {uri}")
        path = uri.replace("s3://", "")
        if "/" in path:
            bucket = path[: path.index("/")]
            url_path = path[path.index("/") + 1 : path.rfind("/")]
        else:
            bucket = path
            url_path = ""
        granule_file = {
            "name": cnm_file.get("name"),
            "path": url_path,
            "url_path": uri,
            "bucket": bucket,
            "source_bucket": bucket,
            "size": cnm_file.get("size"),
            "type": cnm_file.get("type"),
            "fileName": cnm_file.get("name"),
            "key": f"{url_path}/{cnm_file.get('name')}"
            if url_path
            else cnm_file.get("name"),
        }
        if "checksumType" in cnm_file:
            granule_file["checksumType"] = cnm_file.get("checksumType")
        if "checksum" in cnm_file:
            granule_file["checksum"] = cnm_file.get("checksum")
        return granule_file

    def build_https_granule_file(self, cnm_file):
        uri = cnm_file.get("uri", "").strip()
        path = uri.replace("https://", "").replace("http://", "")
        if "/" in path:
            url_path = path[path.index("/") + 1 : path.rfind("/")]
        else:
            url_path = ""
        granule_file = {
            "name": cnm_file.get("name"),
            "path": url_path,
            "size": cnm_file.get("size"),
            "type": cnm_file.get("type"),
        }
        if "checksumType" in cnm_file:
            granule_file["checksumType"] = cnm_file.get("checksumType")
        if "checksum" in cnm_file:
            granule_file["checksum"] = cnm_file.get("checksum")
        return granule_file

    def build_sftp_granule_file(self, cnm_file):
        uri = cnm_file.get("uri", "").strip()
        path = uri.replace("sftp://", "")
        if "/" in path:
            url_path = path[path.index("/") + 1 : path.rfind("/")]
        else:
            url_path = ""
        granule_file = {
            "name": cnm_file.get("name"),
            "path": url_path,
            "url_path": uri,
            "size": cnm_file.get("size"),
            "type": cnm_file.get("type"),
        }
        if "checksumType" in cnm_file:
            granule_file["checksumType"] = cnm_file.get("checksumType")
        if "checksum" in cnm_file:
            granule_file["checksum"] = cnm_file.get("checksum")
        return granule_file


def handler(event, context):
    """handler that gets called by aws lambda

    Parameters
    ----------
    event: dictionary
        event from a lambda call
    context: dictionary
        context from a lambda call

    Returns
    ----------
        string
            A CMA json message
    """
    cumulus_logger.setMetadata(event, context)
    return CNM2CMA.cumulus_handler(event, context=context)
