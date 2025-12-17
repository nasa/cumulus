import datetime
import logging
import re
import urllib.parse
from abc import abstractmethod
from pathlib import Path
from typing import Any, Optional

from common.ummg.base import AsfUmmgBase
from common.ummg.filter import Filter, filter_files
from common.ummg.spatial import UmmgSpatialExtentMixin
from geo_extensions import (
    Transformer,
    polygon_crosses_antimeridian_fixed_size,
    simplify_polygon,
    split_polygon_on_antimeridian_ccw,
)
from mandible.umm_classes import (
    RelatedUrlBuilder,
    TeaUrlBuilder,
    UmmgPlatformMixin,
    UmmgTemporalExtentRangeDateTimeMixin,
    UmmgTemporalExtentSingleDateTimeMixin,
)
from mandible.umm_classes.factory import additional_attribute
from mandible.umm_classes.types import (
    AdditionalAttribute,
    BoundingRectangle,
    CMAGranule,
    CMAGranuleFile,
    Identifier,
    Instrument,
    OrbitCalculatedSpatialDomain,
    PGEVersionClass,
    Platform,
    Project,
    RelatedUrl,
    SpatialExtent,
)

from shapely import geometry
from shapely.geometry import Polygon

from . import (
    CSLC_GRANULE_PATTERN,
    CSLC_STATIC_GRANULE_PATTERN,
    DISP_GRANULE_PATTERN,
    DISP_STATIC_GRANULE_PATTERN,
    DIST_ALERT_GRANULE_PATTERN,
    PGE_VERSION_PATTERN,
    RTC_GRANULE_PATTERN,
    RTC_STATIC_GRANULE_PATTERN,
    TROPO_GRANULE_PATTERN,
)

log = logging.getLogger(__name__)


PRODUCT_DATE_FORMAT = "%Y-%m-%d"
PRODUCT_DATETIME_FORMAT = f"{PRODUCT_DATE_FORMAT}T%H:%M:%S.%fZ"

MISSION_PATTERN = re.compile("S1([A-Z])")

FILE_TYPE_MAP = {
    ".bin": "Binary",
    ".gpkg": "GeoPackage",
    ".h5": "HDF5",
    ".json": "JSON",
    ".md5": "Text File",
    ".nc": "netCDF-4",
    ".png": "PNG",
    ".tif": "GeoTIFF",
    ".xml": "XML",
    ".zarr.json.gz": "Zarr",
    ".yaml": "YAML",
}

POLYGON_TRANSFORMER = Transformer(
    [
        simplify_polygon(0.1),
        split_polygon_on_antimeridian_ccw,
    ]
)


def to_umm_datetime(
    date_string: str,
    format: str = PRODUCT_DATETIME_FORMAT,
) -> datetime.datetime:
    return datetime.datetime.strptime(
        date_string,
        format,
    )


def round_nano_seconds_to_micro(time_str: str) -> str:
    parsed_time_str = time_str.rsplit(".", 1)
    if len(parsed_time_str) == 1:
        return f"{time_str}.000000"
    root, fractional_seconds = parsed_time_str
    fractional_seconds = fractional_seconds.replace("Z", "")
    return f"{root}.{fractional_seconds[:6]}Z"


def to_umm_date(
    date_string: str,
    format: str = PRODUCT_DATE_FORMAT,
) -> datetime.date:
    return to_umm_datetime(date_string, format).date()


def _get_file_type(
    file_name: str,
    default=None,
    file_type_map: dict[str, str] = FILE_TYPE_MAP,
) -> str:
    file_path = Path(file_name)

    for i in range(len(file_path.suffixes)):
        ext = "".join(file_path.suffixes[i:])
        file_type = file_type_map.get(ext)
        if file_type:
            return file_type

    if default:
        return default

    raise KeyError(ext)


def mission_full_name(value: str) -> str:
    m = MISSION_PATTERN.match(value)
    letter = m.group(1)

    return f"Sentinel-1{letter}"


class OperaTeaUrlBuilder(TeaUrlBuilder):
    def __init__(
        self,
        file: CMAGranuleFile,
        download_url: str,
        path_prefix: str,
        include_s3_uri: bool = True,
        file_type_map=FILE_TYPE_MAP,
    ):
        super().__init__(
            file=file,
            download_url=download_url,
            path_prefix=path_prefix,
            include_s3_uri=include_s3_uri,
        )
        self.file_type_map = file_type_map

    def get_http_format(self) -> str:
        return _get_file_type(
            self.file["fileName"],
            file_type_map=self.file_type_map,
        )

    def get_s3_format(self) -> str:
        return _get_file_type(
            self.file["fileName"],
            file_type_map=self.file_type_map,
        )


class OperaUmmgBase(
    UmmgPlatformMixin,
    UmmgSpatialExtentMixin,
    AsfUmmgBase,
):
    def __init__(
        self,
        granule: CMAGranule,
        metadata: dict[str, Any],
        metadata_config: dict,
        distribution_url: str,
        download_host: Optional[str] = None,
    ):
        super().__init__(granule, metadata, metadata_config)
        # Not all OPERA products will have CmrMd (DISP Does Not)
        self.cmr_metadata = metadata.get("CmrMd", {})
        self.distribution_url = distribution_url
        self.download_host = download_host or (urllib.parse.urlparse(distribution_url).netloc)

    @property
    def granule_files_map(self) -> dict[str, CMAGranuleFile]:
        return {key: file for file in self.granule["files"] if (key := file.get("key")) is not None}

    @abstractmethod
    def get_beam_mode(self) -> str:
        pass

    def get_bounding_polygons(self) -> list[Polygon]:
        polygon_wkt = self.product_metadata["boundingPolygon"]

        return POLYGON_TRANSFORMER.from_wkt(polygon_wkt)

    def get_file_format(self, file: CMAGranuleFile) -> str:
        return _get_file_type(
            file["fileName"],
            "ASCII",
            file_type_map=self.get_file_type_map(),
        )

    def get_file_type_map(self) -> dict[str, str]:
        return FILE_TYPE_MAP

    def get_granule_files(self) -> list[CMAGranuleFile]:
        return self.granule_files

    def get_instruments(self) -> list[Instrument]:
        return [
            {
                "ShortName": self.get_instrument_name(),
                "Characteristics": [
                    {
                        "Name": "LookDirection",
                        "Value": self.get_look_direction().upper(),
                    },
                ],
                "OperationalModes": [self.get_beam_mode()],
            },
        ]

    @abstractmethod
    def get_instrument_name(self) -> str:
        pass

    @abstractmethod
    def get_look_direction(self) -> str:
        pass

    def get_production_date_time(self) -> datetime.datetime:
        return to_umm_datetime(self.product_metadata["productionDateTime"])

    def get_projects(self) -> list[Project]:
        return [
            {
                "ShortName": "SNWG/OPERA",
            },
        ]

    def get_related_urls(self) -> list[RelatedUrl]:
        url = urllib.parse.urljoin(self.distribution_url, "s3credentials")

        return super().get_related_urls() + [
            {
                "URL": url,
                "Type": "VIEW RELATED INFORMATION",
                "Description": "S3 credentials endpoint for direct in-region bucket access",
            },
        ]

    def get_related_url_builder(
        self,
        file: CMAGranuleFile,
    ) -> Optional[RelatedUrlBuilder]:
        file_path = Path(file["fileName"])
        bucket = file["bucket"]

        if file_path.name.endswith(".cmr.json"):
            return None

        if bucket.endswith("opera-products"):
            return OperaTeaUrlBuilder(
                file,
                self.distribution_url,
                "OPERA",
                file_type_map=self.get_file_type_map(),
            )

        if bucket.endswith("opera-browse"):
            return OperaTeaUrlBuilder(
                file,
                self.distribution_url,
                "BROWSE/OPERA",
                file_type_map=self.get_file_type_map(),
            )

        return None


class OperaProduct(OperaUmmgBase):
    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        beam_mode = self.get_beam_mode()

        return super().get_additional_attributes() + [
            self.get_additional_attribute(
                "ASCENDING_DESCENDING",
                "orbitPassDirection",
            ),
            additional_attribute("BEAM_MODE", beam_mode),
            additional_attribute("GROUP_ID", self.get_group_id().upper()),
            additional_attribute(
                "LOOK_DIRECTION",
                self.get_look_direction().upper(),
            ),
            self.get_additional_attribute(
                "OPERA_BURST_ID",
                "burstID",
            ),
            self.get_additional_attribute(
                "PATH_NUMBER",
                "trackNumber",
            ),
            {
                "Name": "POLARIZATION",
                "Values": [pol.upper() for pol in self.product_metadata["listOfPolarizations"]],
            },
            additional_attribute(
                "PROCESSING_TYPE",
                self.get_product_short_name(),
            ),
            self.get_additional_attribute(
                "PRODUCT_VERSION",
                "productVersion",
            ),
            additional_attribute("SUBSWATH_NAME", self.get_subswath()),
        ]

    def get_group_id(self) -> str:
        return self.cmr_metadata["groupId"]

    def get_identifiers(self) -> list[Identifier]:
        return super().get_identifiers() + [
            {
                "Identifier": self.product_metadata["isce3Version"],
                "IdentifierType": "Other",
                "IdentifierName": "ISCE3Version",
            },
            {
                "Identifier": self.product_metadata["s1ReaderVersion"],
                "IdentifierType": "Other",
                "IdentifierName": "S1ReaderVersion",
            },
            {
                "Identifier": self.product_metadata["softwareVersion"],
                "IdentifierType": "Other",
                "IdentifierName": "SASVersionId",
            },
        ]

    def get_input_granules(self) -> list[str]:
        input_granules = self.product_metadata["inputGranules"]
        if not input_granules:
            raise Exception("Input granules can not be empty")
        if not isinstance(input_granules, list):
            raise Exception("Input granules must be a list")

        return [Path(granule).stem for granule in input_granules]

    def get_look_direction(self) -> str:
        return self.product_metadata["lookDirection"]

    def get_orbit_calculated_spatial_domains(
        self,
    ) -> list[OrbitCalculatedSpatialDomain]:
        return [
            {
                "OrbitNumber": int(self.product_metadata["absoluteOrbitNumber"]),
            },
        ]

    def get_pge_version_class(self) -> PGEVersionClass:
        pge_version_string = self.product_metadata["pgeVersionString"]
        name, version = PGE_VERSION_PATTERN.match(pge_version_string).groups()

        return {
            "PGEName": name,
            "PGEVersion": version,
        }

    @abstractmethod
    def get_product_short_name(self) -> str:
        pass

    @abstractmethod
    def get_subswath(self) -> str:
        pass


class CslcCommonUmmg(OperaProduct):
    """Shared between CSLC and CSLC STATIC"""

    _CSLC_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S.%f"

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".h5"),
                Filter(suffix=".xml"),
            ],
        )

    def get_beam_mode(self) -> str:
        return self.get_granule_match().group("beam_mode")

    def get_instrument_name(self) -> str:
        return self.product_metadata["instrumentName"]

    def get_platform_name(self) -> str:
        return mission_full_name(self.product_metadata["missionId"])

    def get_production_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["productionDateTime"],
            self._CSLC_DATETIME_FORMAT,
        )

    def get_subswath(self) -> str:
        return self.get_granule_match().group("subswath")


class RtcCommonUmmg(OperaProduct):
    """Shared between RTC and RTC STATIC"""

    _INSTRUMENT_PATTERN = re.compile("Sentinel-1[A-Z] (C)(SAR)")

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            self.get_additional_attribute(
                "BISTATIC_DELAY_CORRECTION",
                "bistaticDelayCorrectionApplied",
            ),
            self.get_additional_attribute(
                "STATIC_TROPO_CORRECTION",
                "staticTroposphericGeolocationCorrectionApplied",
            ),
            self.get_additional_attribute(
                "WET_TROPO_CORRECTION",
                "wetTroposphericGeolocationCorrectionApplied",
            ),
        ]

    def get_beam_mode(self) -> str:
        return self.product_metadata["acquisitionMode"]

    def get_instrument_name(self) -> str:
        m = self._INSTRUMENT_PATTERN.match(self.product_metadata["instrumentName"])
        band, sensor_type = m.groups()

        return f"{band}-{sensor_type}"

    def get_platform_name(self) -> str:
        return self.product_metadata["platform"]

    def get_subswath(self) -> str:
        return self.product_metadata["beamID"].upper()


class NonStaticH5Ummg(
    UmmgTemporalExtentRangeDateTimeMixin,
    OperaProduct,
):
    """Shared between RTC and CSLC"""

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [Filter(suffix=".h5")],
        )

    def get_beginning_date_time(self) -> datetime.datetime:
        return self.get_zero_doppler_start_time()

    def get_ending_date_time(self) -> datetime.datetime:
        return self.get_zero_doppler_end_time()

    @abstractmethod
    def get_zero_doppler_end_time(self) -> datetime.datetime:
        pass

    @abstractmethod
    def get_zero_doppler_start_time(self) -> datetime.datetime:
        pass


class CslcUmmg(NonStaticH5Ummg, CslcCommonUmmg):
    """Unique to CSLC granule product"""

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".h5"),
                Filter(suffix=".xml"),
            ],
        )

    def get_burst_id(self) -> str:
        return self.get_granule_match().group("burst_id")

    def get_granule_pattern(self) -> re.Pattern:
        return CSLC_GRANULE_PATTERN

    def get_product_short_name(self) -> str:
        return "CSLC"

    def get_product_start_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.get_granule_match().group("product_generation_date_time"),
        )

    def get_zero_doppler_end_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["zeroDopplerEndTime"],
            self._CSLC_DATETIME_FORMAT,
        )

    def get_zero_doppler_start_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["zeroDopplerStartTime"],
            self._CSLC_DATETIME_FORMAT,
        )


class DispUmmg(
    UmmgTemporalExtentRangeDateTimeMixin,
    OperaUmmgBase,
):
    _DISP_PRODUCT_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S.%f"
    _DISP_REGEX_DATETIME_FORMAT = "%Y%m%dT%H%M%SZ"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Add a fake entry for the Zarr stack file so that it's included in the
        # related urls.
        zarr_sidecar_file = self.get_zarr_stack_file()
        if zarr_sidecar_file["key"] not in self.granule_files_map:
            self.granule_files = self.granule_files + [zarr_sidecar_file]

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".nc"),
                Filter(suffix=".xml"),
            ],
        )

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            self.get_additional_attribute(
                "ASCENDING_DESCENDING",
                "orbitPassDirection",
            ),
            self.get_additional_attribute(
                "FRAME_NUMBER",
                "frameId",
            ),
            self.get_additional_attribute(
                "PROCESSING_TYPE",
                "processingType",
            ),
            self.get_additional_attribute(
                "PRODUCT_VERSION",
                "productVersion",
            ),
            additional_attribute(
                "POLARIZATION",
                self.get_polarization(),
            ),
            additional_attribute(
                "STACK_ID",
                self.get_stack_id(),
            ),
            self.get_additional_attribute(
                "PATH_NUMBER",
                "trackNumber",
            ),
            additional_attribute(
                "REFERENCE_ZERO_DOPPLER_END_TIME",
                self.date_to_str(self.get_reference_zero_doppler_end_time()),
            ),
            additional_attribute(
                "REFERENCE_ZERO_DOPPLER_START_TIME",
                self.date_to_str(self.get_reference_zero_doppler_start_time()),
            ),
            additional_attribute(
                "SECONDARY_ZERO_DOPPLER_END_TIME",
                self.date_to_str(self.get_secondary_zero_doppler_end_time()),
            ),
            additional_attribute(
                "SECONDARY_ZERO_DOPPLER_START_TIME",
                self.date_to_str(self.get_secondary_zero_doppler_start_time()),
            ),
        ]

    def get_beam_mode(self) -> str:
        return self.product_metadata["acquisitionMode"]

    def get_beginning_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["productStartTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def get_ending_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["productStopTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def get_granule_pattern(self) -> re.Pattern:
        return DISP_GRANULE_PATTERN

    def get_identifiers(self) -> list[Identifier]:
        return super().get_identifiers() + [
            {
                "Identifier": self.product_metadata["dispS1SoftwareVersion"],
                "IdentifierType": "Other",
                "IdentifierName": "DispS1SoftwareVersion",
            },
            {
                "Identifier": self.product_metadata["dolphinSoftwareVersion"],
                "IdentifierType": "Other",
                "IdentifierName": "DolphinSoftwareVersion",
            },
            {
                "Identifier": self.product_metadata["sasSoftwareVersion"],
                "IdentifierType": "Other",
                "IdentifierName": "SASVersionId",
            },
        ]

    def get_instrument_name(self) -> str:
        return self.product_metadata["instrumentName"]

    def get_look_direction(self) -> str:
        return self.product_metadata["lookDirection"]

    def get_pge_version_class(self) -> PGEVersionClass:
        pge_version_string = self.product_metadata["pgeVersionString"]
        name, version = PGE_VERSION_PATTERN.match(pge_version_string).groups()

        return {
            "PGEName": name,
            "PGEVersion": version,
        }

    def get_platform_name(self) -> str:
        # Unused, since there are multiple platforms
        raise RuntimeError("Unreachable!")

    def get_platforms(self) -> list[Platform]:
        return [
            {"ShortName": mission_full_name(platform_code), "Instruments": self.get_instruments()}
            for platform_code in self.product_metadata["platforms"].split(",")
        ]

    def get_polarization(self) -> str:
        return self.get_granule_match().group("polarization")

    def get_production_date_time(self) -> datetime.datetime:
        product_generation_datetime = self.get_granule_match().group("product_generation_date_time")
        return to_umm_datetime(
            product_generation_datetime,
            self._DISP_REGEX_DATETIME_FORMAT,
        )

    def get_reference_zero_doppler_end_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["referenceZeroDopplerEndTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def get_reference_zero_doppler_start_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["referenceZeroDopplerStartTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def get_secondary_zero_doppler_end_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["secondaryZeroDopplerEndTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def get_secondary_zero_doppler_start_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["secondaryZeroDopplerStartTime"],
            self._DISP_PRODUCT_DATETIME_FORMAT,
        )

    def _get_stack_granule_id_non_unique(self) -> str:
        m = self.get_granule_match()
        product_type_prefix = m.group("prefix")
        stack_id = self.get_stack_id()

        return f"{product_type_prefix}_{stack_id}"

    def get_stack_granule_id(self) -> str:
        granule_id = self._get_stack_granule_id_non_unique()

        m = self.get_granule_match()
        product_type_prefix = m.group("prefix")

        stack_collection_name = self.metadata_config["stack_collection"]
        # Cumulus does not allow two collections to contain a granule with the
        # same exact id, so we need to add an extra element to the granule id
        # to distinguish between stacks in the provisional and v1 collection
        collection_maturity = stack_collection_name.removeprefix(
            f"{product_type_prefix}_STACK_",
        )

        return f"{granule_id}_{collection_maturity}"

    def get_stack_id(self) -> str:
        m = self.get_granule_match()
        return m.group("stack_id")

    def get_zarr_stack_file(self) -> CMAGranuleFile:
        zarr_sidecar_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".gz"),
            ],
        )
        zarr_sidecar_file = zarr_sidecar_files[0]
        zarr_stack_granule_id = self.get_stack_granule_id()
        zarr_stack_file_name_stem = self._get_stack_granule_id_non_unique()
        zarr_stack_file_name = f"{zarr_stack_file_name_stem}_short_wavelength_displacement.zarr.json.gz"

        return {
            "size": 0,
            "bucket": zarr_sidecar_file["bucket"],
            # NOTE: Key must match the url_path config in the stack collection!
            "key": (f"{self.metadata_config['stack_collection']}/{zarr_stack_granule_id}/{zarr_stack_file_name}"),
            "fileName": zarr_stack_file_name,
            "type": "data",
            "checksum": "00000000000000000000000000000000",
            "checksumType": "md5",
        }


class DistAlertS1Ummg(OperaUmmgBase):
    """Unique to DIST-ALERT-S1 granule product"""

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".tif"),
            ],
        )

    def get_instruments(self) -> list[Instrument]:
        # TODO(bbarton): undo this minimalist representation of instruments
        return [
            {
                "ShortName": self.get_instrument_name(),
            },
        ]

    def get_beam_mode(self) -> str:
        # TODO(bbarton) implement for real
        return "IW"

    def get_granule_pattern(self) -> re.Pattern:
        return DIST_ALERT_GRANULE_PATTERN

    def get_instrument_name(self) -> str:
        # TODO(bbarton) implement for real
        return "C-SAR"

    def get_look_direction(self) -> str:
        # TODO(bbarton) implement for real
        return "RIGHT"

    def get_platform_name(self) -> str:
        # TODO(bbarton) implement for real
        return "Sentinel-1A"


class RtcUmmg(NonStaticH5Ummg, RtcCommonUmmg):
    """Unique to RTC granule product"""

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".h5"),
                Filter(suffix=".tif"),
                Filter(suffix=".xml"),
            ],
        )

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            self.get_additional_attribute(
                "NOISE_CORRECTION",
                "noiseCorrectionApplied",
            ),
            self.get_additional_attribute(
                "POST_PROCESSING_FILTER",
                "filteringApplied",
            ),
            self.get_additional_attribute(
                "RADIOMETRIC_TERRAIN_CORRECTION",
                "radiometricTerrainCorrectionApplied",
            ),
        ]

    def get_granule_pattern(self) -> re.Pattern:
        return RTC_GRANULE_PATTERN

    def get_product_short_name(self) -> str:
        return "RTC"

    def get_zero_doppler_end_time(self) -> datetime.datetime:
        return to_umm_datetime(self.product_metadata["zeroDopplerEndTime"])

    def get_zero_doppler_start_time(self) -> datetime.datetime:
        return to_umm_datetime(self.product_metadata["zeroDopplerStartTime"])


class TropoUmmg(
    UmmgTemporalExtentRangeDateTimeMixin,
    OperaUmmgBase,
):
    _TROPO_DATE_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"

    @staticmethod
    def get_product_type_desc():
        return "Troposphere Zenith Radar Delays"

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".nc"),
                Filter(suffix=".xml"),
                Filter(file_name=f"{self.get_granule_id()}.png"),
            ],
        )

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            additional_attribute(
                "PRODUCT_VERSION",
                self.get_product_version(),
            ),
            additional_attribute(
                "PRODUCT_TYPE",
                self.get_product_type(),
            ),
            additional_attribute(
                "PRODUCT_TYPE_DESC",
                self.get_product_type_desc(),
            ),
        ]

    def get_granule_pattern(self) -> re.Pattern:
        return TROPO_GRANULE_PATTERN

    def get_granule_id(self) -> str:
        return self.granule["granuleId"]

    def get_bounding_rectangles(self) -> list[BoundingRectangle]:
        precision = 5
        return [
            {
                "WestBoundingCoordinate": round(float(self.product_metadata["boundWest"]), precision),
                "NorthBoundingCoordinate": round(float(self.product_metadata["boundNorth"]), precision),
                "EastBoundingCoordinate": round(float(self.product_metadata["boundEast"]), precision),
                "SouthBoundingCoordinate": round(float(self.product_metadata["boundSouth"]), precision),
            }
        ]

    def get_spatial_extent(self) -> SpatialExtent:
        return {
            "GranuleLocalities": ["Global"],
            "HorizontalSpatialDomain": {
                "Geometry": {"BoundingRectangles": self.get_bounding_rectangles()},
            },
        }

    def get_production_date_time(self) -> datetime.datetime:
        production_date_time = self.product_metadata["productionDateTime"]
        trimmed_date_time = re.sub(
            r"\.(\d+?)Z", lambda m: "." + m.group(1)[:6].ljust(6, "0") + "Z", production_date_time
        )
        return to_umm_datetime(trimmed_date_time)

    def get_beginning_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["beginDateTime"],
            self._TROPO_DATE_TIME_FORMAT,
        )

    def get_ending_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            self.product_metadata["endDateTime"],
            self._TROPO_DATE_TIME_FORMAT,
        )

    def get_pge_version_class(self) -> PGEVersionClass:
        pge_version_string = self.product_metadata["pgeVersionString"]
        name, version = PGE_VERSION_PATTERN.match(pge_version_string).groups()

        return {
            "PGEName": name,
            "PGEVersion": version,
        }

    def get_product_version(self):
        granule_pattern = self.get_granule_pattern()
        granule_id = self.get_granule_id()
        match = granule_pattern.match(granule_id)

        if match:
            groups = match.groupdict()
            return groups["product_version"]

        raise Exception("Granule ID did not match pattern")

    def get_product_type(self):
        granule_pattern = self.get_granule_pattern()
        granule_id = self.get_granule_id()
        match = granule_pattern.match(granule_id)

        if match:
            groups = match.groupdict()
            return groups["product_short_name"]

        raise Exception("Granule ID did not match pattern")

    def get_identifiers(self) -> list[Identifier]:
        return super().get_identifiers() + [
            {
                "Identifier": self.product_metadata["sasVersionId"][0],
                "IdentifierType": "Other",
                "IdentifierName": "SASVersionId",
            },
        ]

    def get_input_granules(self) -> list[str]:
        input_granules = [self.product_metadata["inputGranules"].strip()]

        if not input_granules:
            raise Exception("Input granules can not be empty")
        if not isinstance(input_granules, list):
            raise Exception("Input granules must be a list")

        return [Path(granule).stem for granule in input_granules]

    def get_beam_mode(self) -> str:
        return "IW"

    def get_instrument_name(self) -> str:
        return "C-SAR"

    def get_look_direction(self) -> str:
        return "RIGHT"

    def get_platform_name(self) -> str:
        return "Sentinel-1A"

    def get_platforms(self) -> list[Platform]:
        return []


class H5StaticUmmg(
    UmmgTemporalExtentSingleDateTimeMixin,
    OperaProduct,
):
    """Shared between CSLC-STATIC and RTC-STATIC"""

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            additional_attribute(
                "VALIDITY_START_DATE",
                self.date_to_str(self.get_validity_start_date()),
            ),
        ]

    def get_product_start_time(self) -> datetime.datetime:
        return datetime.datetime.combine(
            self.get_validity_start_date(),
            datetime.time(0, 0, 0),
        )

    def get_single_date_time(self) -> datetime.datetime:
        return self.get_product_start_time()

    def get_validity_start_date(self) -> datetime.date:
        return to_umm_date(
            self.get_granule_match().group("validity_start_date"),
            "%Y%m%d",
        )


class CslcStaticUmmg(H5StaticUmmg, CslcCommonUmmg):
    """Unique to CSLC-STATIC layer products"""

    def get_granule_pattern(self) -> re.Pattern:
        return CSLC_STATIC_GRANULE_PATTERN

    def get_product_short_name(self) -> str:
        return "CSLC-STATIC"


class DispStaticUmmg(
    UmmgTemporalExtentSingleDateTimeMixin,
    OperaUmmgBase,
):
    _DISP_STATIC_DATETIME_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"
    _DISP_STATIC_FILE_TYPE_MAP = {
        **FILE_TYPE_MAP,
        ".tif": "COG",
    }

    @staticmethod
    def get_product_type_desc():
        return "Sentinel-1 Displacement Static Layer Product"

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".tif"),
                Filter(suffix=".xml"),
                Filter(file_name=r".*_BROWSE\.png"),
            ],
        )

    def get_additional_attributes(self) -> list[AdditionalAttribute]:
        return super().get_additional_attributes() + [
            self.get_additional_attribute(
                "ASCENDING_DESCENDING",
                "ascendingDescending",
            ),
            self.get_additional_attribute(
                "FRAME_NUMBER",
                "frameNumber",
            ),
            self.get_additional_attribute(
                "PATH_NUMBER",
                "pathNumber",
            ),
            additional_attribute(
                "PRODUCT_TYPE",
                self.get_product_type(),
            ),
            additional_attribute(
                "PRODUCT_TYPE_DESC",
                self.get_product_type_desc(),
            ),
            self.get_additional_attribute(
                "PRODUCT_VERSION",
                "productVersion",
            ),
            additional_attribute(
                "VALIDITY_START_DATE",
                self.date_to_str(self.get_validity_start_date()),
            ),
        ]

    def get_beam_mode(self) -> str:
        return self.product_metadata["acquisitionMode"]

    def get_bounding_polygons(self) -> list[Polygon]:
        text = self.product_metadata["boundingPolygon"]

        polygons = [
            self._get_bounding_polygon_from_point_list([float(s) for s in points.split()])
            for points in re.findall(r"\(\(([^)]*)\)\)", text)
        ]

        return POLYGON_TRANSFORMER.transform(polygons)

    def _get_bounding_polygon_from_point_list(self, point_list: list[float]) -> Polygon:
        i = iter(point_list)

        return Polygon((lon, lat) for lon, lat in zip(i, i))

    def get_file_type_map(self) -> dict[str, str]:
        return self._DISP_STATIC_FILE_TYPE_MAP

    def get_granule_pattern(self) -> re.Pattern:
        return DISP_STATIC_GRANULE_PATTERN

    def get_identifiers(self) -> list[Identifier]:
        return super().get_identifiers() + [
            {
                "Identifier": self.product_metadata["sasVersionId"],
                "IdentifierType": "Other",
                "IdentifierName": "SASVersionId",
            },
        ]

    def get_instrument_name(self) -> str:
        instrument_name = {
            "Sentinel-1 CSAR": "C-SAR",
        }
        return instrument_name[self.product_metadata["instrumentName"]]

    def get_look_direction(self) -> str:
        return self.product_metadata["lookDirection"]

    def get_pge_version_class(self) -> PGEVersionClass:
        pge_version_string = self.product_metadata["pgeVersionString"]
        name, version = PGE_VERSION_PATTERN.match(pge_version_string).groups()

        return {
            "PGEName": name,
            "PGEVersion": version,
        }

    def get_platform_name(self) -> str:
        return self.get_granule_match().group("platform")

    def get_platforms(self) -> list[Platform]:
        return [
            {
                "ShortName": mission_full_name(self.get_platform_name()),
                "Instruments": self.get_instruments(),
            }
        ]

    def get_producer_granule_id(self) -> str:
        return self.product_metadata["producerGranuleId"]

    def get_product_start_time(self) -> datetime.datetime:
        return datetime.datetime.combine(
            self.get_validity_start_date(),
            datetime.time(0, 0, 0),
        )

    def get_product_type(self):
        return self.get_granule_match().group("product_short_name")

    def get_production_date_time(self) -> datetime.datetime:
        return to_umm_datetime(
            round_nano_seconds_to_micro(self.product_metadata["productionDateTime"]),
            self._DISP_STATIC_DATETIME_FORMAT,
        )

    def get_single_date_time(self) -> datetime.datetime:
        return self.get_product_start_time()

    def get_validity_start_date(self) -> datetime.date:
        return to_umm_date(
            self.get_granule_match().group("validity_start_date"),
            "%Y%m%d",
        )


class RtcStaticUmmg(H5StaticUmmg, RtcCommonUmmg):
    """Unique to RTC-STATIC layer products"""

    def set_product_files(self):
        self.product_files = filter_files(
            self.granule_files,
            [
                Filter(suffix=".tif"),
                Filter(suffix=".xml"),
            ],
        )

    def get_bounding_polygons(self) -> list[Polygon]:
        east = float(self.product_metadata["boundEast"])
        north = float(self.product_metadata["boundNorth"])
        west = float(self.product_metadata["boundWest"])
        south = float(self.product_metadata["boundSouth"])

        polygon = geometry.box(east, north, west, south, ccw=True)

        bounding_polygons = list(split_polygon_on_antimeridian_ccw(polygon))
        # There will be some false positives using this method
        crosses_idl_heuristic = polygon_crosses_antimeridian_fixed_size(
            polygon,
            min_lon_extent=5,
        )
        if crosses_idl_heuristic and len(bounding_polygons) == 1:
            log.warning(
                "Polygon was close to antimeridian but remained unsplit. This "
                "is likely due to a false positive in the heuristic check.\n"
                "Polygon: %s\nis_ccw: %s\nSplit Polygons: %s",
                polygon,
                polygon.exterior.is_ccw,
                bounding_polygons,
            )
        # But there should be no false negatives
        if not crosses_idl_heuristic and len(bounding_polygons) > 1:
            log.error(
                "Polygon was not close to antimeridian but was split! Polygon: %s\nis_ccw: %s\nSplit Polygons: %s",
                polygon,
                polygon.exterior.is_ccw,
                bounding_polygons,
            )
            raise RuntimeError(
                "Bounding polygon was not close to antimeridian but was split!",
            )

        return bounding_polygons

    def get_granule_pattern(self) -> re.Pattern:
        return RTC_STATIC_GRANULE_PATTERN

    def get_product_short_name(self) -> str:
        return "RTC-STATIC"
