import re
from pathlib import Path
from typing import List, Optional

from shapely import geometry
from shapely.geometry import Polygon

from .collection_md import METADATA_CONFIG


class OperaAsfMd:
    def __init__(self, granule: dict, meta: dict) -> None:
        self.granule = granule
        self.meta = meta
        self.metadata_config = METADATA_CONFIG[self.meta["collection"]["name"]]
        self.granule_ur = granule["granuleId"]
        if "BROWSE" in self.granule["files"][0]["fileName"]:
            self.is_browse = True
        else:
            self.is_browse = False

    @staticmethod
    def _remove_missing(asf_md: dict) -> dict:
        return {k: v for k, v in asf_md.items() if v}

    def get_collection(self) -> dict:
        return {
            "data_granule_type": self.get_collection_data_granule_type(),
            "processing_level": self.get_collection_processing_level(),
        }

    def get_product(self) -> dict:
        return {
            "files": self.get_product_files(),
            "data_center": self.get_product_data_center(),
            "format": self.get_product_format(),
            "maturity": self.get_product_maturity(),
            "status": self.get_product_status(),
            "processing_type": self.get_product_processing_type(),
            "product_name": self.get_product_name(),
            "group_name": self.get_product_group_name(),
            "mission": self.get_product_mission(),
        }

    def get_platform(self) -> dict:
        return {
            "short_name": self.get_platform_short_name(),
            "data_sensor_type": self.get_platform_data_sensor_type(),
            "beam_mode": self.get_platform_beam_mode(),
            "beam_swath": self.get_platform_beam_swath(),
            "polarizations": self.get_platform_polarizations(),
            "platform_type": self.get_platform_type(),
        }

    def get_provenance(self) -> dict:
        return {
            "data_provider": self.get_provenance_data_provider(),
            "source_product": self.get_provenance_source_product(),
            "processing_time": self.get_provenance_processing_time(),
        }

    def get_orbital(self) -> dict:
        return {
            "path_number": self.get_orbital_path_number(),
            "orbit_direction": self.get_orbital_orbit_direction(),
            "revolution": self.get_orbital_revolution(),
        }

    def get_aux(self) -> dict:
        return {
            "browse_filename": self.get_aux_browse_filename(),
            "dist_host": self.get_aux_distribution_host(),
        }

    def get_attributes(self) -> dict:
        return {
            "processing_description": self.get_attributes_processing_description(),
            "beam_mode_desc": self.get_attributes_beam_mode_desc(),
        }

    def get_geospatial(self) -> dict:
        return {"wkt": self.get_geospatial_coordinates()}

    def get_temporal(self) -> dict:
        return {
            "start_time": self.get_temporal_start_time(),
            "end_time": self.get_temporal_end_time(),
        }

    # Collection getters
    def get_collection_data_granule_type(self) -> str:
        return self.metadata_config.data_granule_type

    def get_collection_processing_level(self) -> str:
        return re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        ).group("level")

    # Product getters
    def get_product_files(self) -> List[dict]:
        return [
            {
                "bucket": f"{file['bucket']}/{Path(file['key']).parent}/",
                "md5sum": file["checksum"],
                "key": file["fileName"],
                "product_volume_bytes": file["size"],
            }
            for file in self.granule["files"]
        ]

    def get_product_data_center(self) -> str:
        data_center = {
            "dev": "cumulus-edc-dev",
            "int": "cumulus-edc-int",
            "test": "cumulus-edc-test",
            "prod": "cumulus-edc-prod",
        }
        return data_center[self.meta["stack"].rsplit("-", 1)[1]]

    def get_product_format(self) -> str:
        if self.is_browse:
            return "BROWSE"
        return self.metadata_config.product_format

    def get_product_maturity(self) -> str:
        return self.meta["stack"].rsplit("-", 1)[1]

    def get_product_status(self) -> str:
        return "normal"

    def get_product_processing_type(self) -> str:
        if self.is_browse:
            return "BROWSE"
        return self.metadata_config.datapool_product_type

    def get_product_name(self) -> str:
        return self.granule_ur

    def get_product_group_name(self) -> str:
        if self.meta["CmrMd"]["groupId"] is None or self.is_browse:
            return self.granule_ur
        return self.meta["CmrMd"]["groupId"]

    def get_product_mission(self) -> str:
        return self.metadata_config.product_mission

    # Platform getters
    def get_platform_short_name(self) -> str:
        return self.metadata_config.platform_short_name

    def get_platform_data_sensor_type(self) -> str:
        return self.metadata_config.platform_data_sensor_type

    def get_platform_beam_mode(self) -> Optional[str]:
        m = re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        )
        if m and "beam_mode" in m.groupdict():
            return m.group("beam_mode")

        return None

    def get_platform_beam_swath(self) -> str:
        m = re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        )
        return m.groupdict().get("subswath")

    def get_platform_polarizations(self) -> List[str]:
        m = re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        )
        groupdict = m.groupdict()

        polarizations = groupdict.get("polarization") or self.meta["ProductMd"].get("listOfPolarizations") or []

        if isinstance(polarizations, list):
            return polarizations
        return [polarizations]

    def get_platform_type(self) -> str:
        return self.metadata_config.platform_data_sensor_type

    # Provenance getters
    def get_provenance_data_provider(self) -> str:
        return self.metadata_config.provider

    def get_provenance_source_product(self) -> List[str]:
        return self.meta["ProductMd"].get("inputGranules") or []

    @staticmethod
    def _round_nano_seconds_to_micro(time_str: str) -> str:
        parsed_time_str = time_str.rsplit(".", 1)
        if len(parsed_time_str) == 1:
            return f"{time_str}.000000"
        root, fractional_seconds = parsed_time_str
        return f"{root}.{fractional_seconds[:6]}Z"

    def get_provenance_processing_time(self) -> List[str]:
        try:
            return [
                re.match(
                    self.metadata_config.granule_pattern,
                    self.granule_ur,
                ).group("product_generation_date_time")
            ]
        except IndexError:
            return [self._round_nano_seconds_to_micro(self.meta["ProductMd"]["productionDateTime"])]

    # Orbital getters
    def get_orbital_path_number(self) -> int:
        return self.meta["ProductMd"].get("trackNumber", 1)

    def get_orbital_orbit_direction(self) -> str:
        return self.meta["ProductMd"].get("orbitPassDirection", 1)

    def get_orbital_revolution(self) -> int:
        return self.meta.get("ProductMd").get("absoluteOrbitNumber", 1)

    # Aux getters
    def get_aux_browse_filename(self) -> str:
        return self.meta["browse"]

    def get_aux_distribution_host(self) -> str:
        return self.meta["distribution_host"]

    # Attributes getters
    def get_attributes_processing_description(self) -> str:
        return self.metadata_config.processing_description

    def get_attributes_beam_mode_desc(self) -> str:
        beam_mode_desc_map = {
            "IW": (
                "Interferometric Wide. 250 km swath, 5 m x 20 m spatial "
                "resolution and burst synchronization for interferometry. "
                "IW is considered to be the standard mode over land masses."
            ),
            "EW": ("Extended Wide. 400 km swath and 25 m x 100 m spatial resolution (3-looks)"),
        }
        # TODO(gjclark): Ensure that `None` actually writes to the ASF database through rain
        return beam_mode_desc_map.get(self.get_platform_beam_mode()) or None

    # Geospatial getters
    def get_geospatial_coordinates(self) -> str:
        if any(
            prefix in self.meta["collection"]["name"]
            for prefix in (
                "RTC-S1-STATIC",
                "OPERA_L4_TROPO",
            )
        ):
            bbox = (
                float(self.meta["ProductMd"]["boundEast"]),
                float(self.meta["ProductMd"]["boundNorth"]),
                float(self.meta["ProductMd"]["boundWest"]),
                float(self.meta["ProductMd"]["boundSouth"]),
            )
            polygon = geometry.box(*bbox, ccw=True)
            return polygon.wkt

        if any(prefix in self.meta["collection"]["name"] for prefix in ("DISP-S1-STATIC",)):
            text = self.meta["ProductMd"]["boundingPolygon"]
            polygons = [
                self._get_bounding_polygon_from_point_list([float(s) for s in points.split()])
                for points in re.findall(r"\(\(([^)]*)\)\)", text)
            ]
            multipolygon = geometry.MultiPolygon(polygons)
            return multipolygon.wkt

        return self.meta["ProductMd"]["boundingPolygon"]

    def _get_bounding_polygon_from_point_list(self, point_list: list[float]) -> Polygon:
        i = iter(point_list)

        return Polygon((lon, lat) for lon, lat in zip(i, i))

    # Temporal getters
    def get_temporal_start_time(self) -> str:
        product_md_time = self.meta["ProductMd"].get("zeroDopplerStartTime") or self.meta["ProductMd"].get(
            "beginDateTime"
        )
        m = re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        )
        groupdict = m.groupdict()
        return groupdict.get("validity_start_date") or groupdict.get("date_time_1") or product_md_time

    def get_temporal_end_time(self) -> str:
        product_md_time = self.meta["ProductMd"].get("zeroDopplerEndTime") or self.meta["ProductMd"].get("endDateTime")
        m = re.match(
            self.metadata_config.granule_pattern,
            self.granule_ur,
        )
        groupdict = m.groupdict()
        return groupdict.get("validity_start_date") or groupdict.get("date_time_2") or product_md_time

    def get_asf_md(self) -> dict:
        asf_md = {
            "collection": self.get_collection(),
            "product": self.get_product(),
            "platform": self.get_platform(),
            "provenance": self.get_provenance(),
            "orbital": self.get_orbital(),
            "aux": self.get_aux(),
            "attr": self.get_attributes(),
            "geospatial": self.get_geospatial(),
            "temporal": self.get_temporal(),
        }
        return self._remove_missing(asf_md)
