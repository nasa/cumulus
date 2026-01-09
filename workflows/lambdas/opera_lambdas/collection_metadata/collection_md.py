from dataclasses import dataclass
from typing import Dict, Optional, Pattern, Type

from metaspec import (
    cslc_s1,
    cslc_s1_static,
    disp_s1,
    disp_s1_static,
    dist_alert_s1,
    rtc_s1,
    rtc_s1_static,
    tropo_zenith,
)

from . import (
    CSLC_GRANULE_PATTERN,
    CSLC_STATIC_GRANULE_PATTERN,
    DISP_GRANULE_PATTERN,
    DISP_STATIC_GRANULE_PATTERN,
    DIST_ALERT_GRANULE_PATTERN,
    RTC_GRANULE_PATTERN,
    RTC_STATIC_GRANULE_PATTERN,
    TROPO_GRANULE_PATTERN,
)
from .ummg import (
    CslcStaticUmmg,
    CslcUmmg,
    DispStaticUmmg,
    DispUmmg,
    DistAlertS1Ummg,
    OperaUmmgBase,
    RtcStaticUmmg,
    RtcUmmg,
    TropoUmmg,
)


@dataclass
class MetadataConfig:
    collection: str
    cmr_info: dict
    data_granule_type: str
    datapool_product_type: str
    granule_pattern: Pattern[str]
    metaspec_config: dict
    platform_short_name: str
    platform_data_sensor_type: str
    product_format: str
    product_mission: str
    processing_description: str
    provider: str
    ummg_class: Type[OperaUmmgBase]
    stack_collection: Optional[str] = None


# Main metadata config. Each collection gets an entry here.
METADATA_CONFIG: Dict[str, MetadataConfig] = {}


def add_config(config: MetadataConfig):
    key = config.collection
    if key in METADATA_CONFIG:
        raise ValueError(f"'{key}' already exists!")
    METADATA_CONFIG[config.collection] = config


add_config(
    MetadataConfig(
        collection="OPERA_L2_CSLC-S1_V1",
        cmr_info={
            "ShortName": "OPERA_L2_CSLC-S1_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="CSLC",
        granule_pattern=CSLC_GRANULE_PATTERN,
        metaspec_config={
            "sources": cslc_s1.SOURCES,
            "template": cslc_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Coregistered Single-Look Complex Product",
        provider="JPL",
        ummg_class=CslcUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DISP-S1_PROVISIONAL_V0",
        cmr_info={
            "ShortName": "OPERA_L3_DISP-S1_PROVISIONAL_V0",
            "Version": "0",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="DISP",
        granule_pattern=DISP_GRANULE_PATTERN,
        metaspec_config={
            "sources": disp_s1.SOURCES,
            "template": disp_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="NC",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        stack_collection="OPERA_L3_DISP-S1_STACK_PROVISIONAL_V0",
        ummg_class=DispUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DISP-S1_V1",
        cmr_info={
            "ShortName": "OPERA_L3_DISP-S1_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="DISP",
        granule_pattern=DISP_GRANULE_PATTERN,
        metaspec_config={
            "sources": disp_s1.SOURCES,
            "template": disp_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="NC",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        stack_collection="OPERA_L3_DISP-S1_STACK_V1",
        ummg_class=DispUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L2_RTC-S1_V1",
        cmr_info={
            "ShortName": "OPERA_L2_RTC-S1_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="RTC",
        granule_pattern=RTC_GRANULE_PATTERN,
        metaspec_config={
            "sources": rtc_s1.SOURCES,
            "template": rtc_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=RtcUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L4_TROPO-ZENITH_PROVISIONAL_V0",
        cmr_info={
            "ShortName": "OPERA_L4_TROPO-ZENITH_PROVISIONAL_V0",
            "Version": "0",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="TROPO",
        granule_pattern=TROPO_GRANULE_PATTERN,
        metaspec_config={
            "sources": tropo_zenith.SOURCES,
            "template": tropo_zenith.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="ECMWF",
        product_format="NC",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        ummg_class=TropoUmmg,
    ),
)

add_config(
    MetadataConfig(
        collection="OPERA_L4_TROPO-ZENITH_V1",
        cmr_info={
            "ShortName": "OPERA_L4_TROPO-ZENITH_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="TROPO",
        granule_pattern=TROPO_GRANULE_PATTERN,
        metaspec_config={
            "sources": tropo_zenith.SOURCES,
            "template": tropo_zenith.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="ECMWF",
        product_format="NC",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        ummg_class=TropoUmmg,
    ),
)

# Static Layers
add_config(
    MetadataConfig(
        collection="OPERA_L2_CSLC-S1-STATIC_V1",
        cmr_info={
            "ShortName": "OPERA_L2_CSLC-S1-STATIC_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="CSLC-STATIC",
        granule_pattern=CSLC_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": cslc_s1_static.SOURCES,
            "template": cslc_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=CslcStaticUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DISP-S1-STATIC_PROVISIONAL_V0",
        cmr_info={
            "ShortName": "OPERA_L3_DISP-S1-STATIC_PROVISIONAL_V0",
            "Version": "0",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="DISP-STATIC",
        granule_pattern=DISP_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": disp_s1_static.SOURCES,
            "template": disp_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        stack_collection="OPERA_L3_DISP-S1-STATIC_PROVISIONAL_V0",
        ummg_class=DispStaticUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DISP-S1-STATIC_V1",
        cmr_info={
            "ShortName": "OPERA_L3_DISP-S1-STATIC_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        # TODO(gjclark): Create this in ASF DB?
        datapool_product_type="DISP-STATIC",
        granule_pattern=DISP_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": disp_s1_static.SOURCES,
            "template": disp_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        stack_collection="OPERA_L3_DISP-S1-STATIC_V1",
        ummg_class=DispStaticUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DIST-ALERT-S1_PROVISIONAL_V0",
        cmr_info={
            "ShortName": "OPERA_L3_DIST-ALERT-S1_PROVISIONAL_V0",
            "Version": "0",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="DIST",
        granule_pattern=DIST_ALERT_GRANULE_PATTERN,
        metaspec_config={
            "sources": dist_alert_s1.SOURCES,
            "template": dist_alert_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        ummg_class=DistAlertS1Ummg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L3_DIST-ALERT-S1_V1",
        cmr_info={
            "ShortName": "OPERA_L3_DIST-ALERT-S1_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="DIST",
        granule_pattern=DIST_ALERT_GRANULE_PATTERN,
        metaspec_config={
            "sources": dist_alert_s1.SOURCES,
            "template": dist_alert_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="",
        provider="JPL",
        ummg_class=DistAlertS1Ummg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L2_RTC-S1-STATIC_V1",
        cmr_info={
            "ShortName": "OPERA_L2_RTC-S1-STATIC_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="RTC-STATIC",
        granule_pattern=RTC_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": rtc_s1_static.SOURCES,
            "template": rtc_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=RtcStaticUmmg,
    )
)

# CALVAL
add_config(
    MetadataConfig(
        collection="OPERA_L2_CSLC-S1_CALVAL_V1",
        cmr_info={
            "ShortName": "OPERA_L2_CSLC-S1_CALVAL_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="CSLC",
        granule_pattern=CSLC_GRANULE_PATTERN,
        metaspec_config={
            "sources": cslc_s1.SOURCES,
            "template": cslc_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Coregistered Single-Look Complex Product",
        provider="JPL",
        ummg_class=CslcUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L2_RTC-S1_CALVAL_V1",
        cmr_info={
            "ShortName": "OPERA_L2_RTC-S1_CALVAL_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="RTC",
        granule_pattern=RTC_GRANULE_PATTERN,
        metaspec_config={
            "sources": rtc_s1.SOURCES,
            "template": rtc_s1.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=RtcUmmg,
    )
)

# CALVAL Static Layers
add_config(
    MetadataConfig(
        collection="OPERA_L2_CSLC-S1-STATIC_CALVAL_V1",
        cmr_info={
            "ShortName": "OPERA_L2_CSLC-S1-STATIC_CALVAL_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="CSLC-STATIC",
        granule_pattern=CSLC_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": cslc_s1_static.SOURCES,
            "template": cslc_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="HDF5",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=CslcStaticUmmg,
    )
)

add_config(
    MetadataConfig(
        collection="OPERA_L2_RTC-S1-STATIC_CALVAL_V1",
        cmr_info={
            "ShortName": "OPERA_L2_RTC-S1-STATIC_CALVAL_V1",
            "Version": "1",
        },
        data_granule_type="OPERA_S1_SCENE",
        datapool_product_type="RTC-STATIC",
        granule_pattern=RTC_STATIC_GRANULE_PATTERN,
        metaspec_config={
            "sources": rtc_s1_static.SOURCES,
            "template": rtc_s1_static.TEMPLATE,
        },
        platform_short_name="OPERA-S1",
        platform_data_sensor_type="SAR",
        product_format="TIF",
        product_mission="OPERA-S1",
        processing_description="Radiometric Terrain-Corrected Product",
        provider="JPL",
        ummg_class=RtcStaticUmmg,
    )
)
