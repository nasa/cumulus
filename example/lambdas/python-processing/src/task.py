"""Reference python activity implementaion.

Creates a stub cumulus-process-py stub implementation that
takes a payload and returns a mocked output for test purposes
"""

import copy
import hashlib
import os

from cumulus_process import Process
from cumulus_process.s3 import upload


class PythonProcess(Process):
    """A subclass of Process for creating .md5 hash files for test Modis granules.

    This is an example and does not intended for processing MODIS Products
    """

    @property
    def input_keys(self):
        """Input key map.

        This property helps the processing step to distinguish incoming files
        from one another.
        """
        return {
            "hdf": r"^.*\.hdf$",
            "all": r".*",
        }

    def build_s3_uri(self, bucket, key):
        """Build S3 URI for bucket/key."""
        return f"s3://{bucket}/{key}"

    def process(self):
        granules = copy.deepcopy(self.input["granules"])
        # We have to reassign the class input each time in an activity
        # as the library doesn't appear to handle download *and* the service
        # case.   This should be fixed.
        original_file_names = [
            self.build_s3_uri(file["bucket"], file["key"])
            for granule in granules
            for file in granule["files"]
        ]
        self.input = [
            self.build_s3_uri(file["bucket"], file["key"])
            for granule in granules
            for file in granule["files"]
            if file["type"] == "data"
        ]
        local_data_file_list = self.fetch("hdf", remote=False)
        metadata_file_list = list(map(self.add_ancillary_file, local_data_file_list))
        self.clean_output()
        return metadata_file_list + original_file_names

    def add_ancillary_file(self, local_file):
        """Add ancillary file."""
        config = self.config
        md5_sum = self._get_md5_sum(local_file)

        md5_file = f"{local_file}.md5"
        filename = os.path.split(md5_file)[1]
        collection_string = (
            f"{config['collection']['name']}__" + f"{config['collection']['version']}"
        )
        md5_key = (
            f"s3://{config['buckets']['internal']['name']}/staging/"
            + f"{config['stack']}/{collection_string}/{filename}"
        )
        self._write_md5sum_file(md5_file, md5_sum)
        upload(md5_file, md5_key)
        return md5_key

    def _write_md5sum_file(self, md5_file, md5_sum):
        with open(md5_file, "w", encoding="utf8") as write_file:
            write_file.write(md5_sum)

    def _get_md5_sum(self, local_file):
        with open(local_file, "rb") as file:
            md5sum = hashlib.file_digest(file, hashlib.md5).hexdigest()
        return md5sum


if __name__ == "__main__":
    PROCESS = PythonProcess({})
    PROCESS.cumulus_activity()
