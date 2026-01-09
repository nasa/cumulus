from mandible.metadata_mapper.builder import build, mapped

SOURCES = {
    "nc": {
        "storage": {
            "class": "S3File",
            "filters": {
                "fileName": r".*\.nc",
                "type": "data",
            },
        },
        "format": {
            # https://docs.unidata.ucar.edu/netcdf-c/current/interoperability_hdf5.html
            # According to the discussion above we can use H5 readers for NetCDF with sufficient safety.
            "class": "H5",
        },
    },
    "iso.xml": {
        "storage": {
            "class": "S3File",
            "filters": {
                "fileName": r".*\.iso\.xml",
                "type": "metadata",
            },
        },
        "format": {
            "class": "Xml",
        },
    },
}


def _iso_additional_attribute_key(name: str) -> str:
    return (
        "/gmi:MI_Metadata/gmd:contentInfo/gmd:MD_CoverageDescription/gmd:dimension/gmd:MD_Band/gmd:otherProperty"
        "/gco:Record/eos:AdditionalAttributes/eos:AdditionalAttribute[eos:reference/"
        f"eos:EOS_AdditionalAttributeDescription/eos:name/gco:CharacterString='{name}']/"
        "eos:value/gco:CharacterString"
    )


def _data_granule_identifier_key(name: str) -> str:
    return (
        "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:citation/gmd:CI_Citation/gmd:identifier"
        f"[gmd:MD_Identifier/gmd:description/gco:CharacterString='{name}']"
        "/gmd:MD_Identifier/gmd:code/gco:CharacterString"
    )


TEMPLATE = build(
    {
        "ProductMd": {
            "acquisitionMode": mapped("nc", "/identification/acquisition_mode"),
            "boundingPolygon": mapped("nc", "/identification/bounding_polygon"),
            "dispS1SoftwareVersion": mapped("nc", "metadata/disp_s1_software_version"),
            "dolphinSoftwareVersion": mapped("nc", "metadata/dolphin_software_version"),
            "frameId": mapped("nc", "/identification/frame_id"),
            "instrumentName": mapped("nc", "/identification/instrument_name"),
            "lookDirection": mapped("nc", "/identification/look_direction"),
            "orbitPassDirection": mapped("nc", "/identification/orbit_pass_direction"),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage"
                    "/gmd:processStep/gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing/gmi:identifier"
                    "/gmd:MD_Identifier/gmd:code/gco:CharacterString"
                ),
            ),
            "platforms": mapped("nc", "/identification/source_data_satellite_names"),
            "processingType": mapped("iso.xml", _iso_additional_attribute_key("ProductType")),
            "productStartTime": mapped("nc", "/identification/reference_datetime"),
            "productStopTime": mapped("nc", "/identification/secondary_datetime"),
            "productVersion": mapped("nc", "/identification/product_version"),
            "referenceZeroDopplerEndTime": mapped("nc", "/identification/reference_zero_doppler_end_time"),
            "referenceZeroDopplerStartTime": mapped("nc", "/identification/reference_zero_doppler_start_time"),
            "sasSoftwareVersion": mapped("iso.xml", _data_granule_identifier_key("OtherId: SASVersionId")),
            "secondaryZeroDopplerEndTime": mapped("nc", "/identification/secondary_zero_doppler_end_time"),
            "secondaryZeroDopplerStartTime": mapped("nc", "/identification/secondary_zero_doppler_start_time"),
            "trackNumber": mapped("nc", "/identification/track_number"),
        },
    }
)
