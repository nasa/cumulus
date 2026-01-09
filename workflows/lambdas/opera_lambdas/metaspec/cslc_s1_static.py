from mandible.metadata_mapper.builder import build, mapped

SOURCES = {
    "h5": {
        "storage": {
            "class": "S3File",
            "filters": {
                "fileName": r".*\.h5",
                "type": "data",
            },
        },
        "format": {"class": "H5"},
    },
    "iso.xml": {
        "storage": {
            "class": "S3File",
            "filters": {
                "fileName": r".*\.iso\.xml$",
                "type": "metadata",
            },
        },
        "format": {"class": "Xml"},
    },
}

TEMPLATE = build(
    {
        "ProductMd": {
            "absoluteOrbitNumber": mapped("h5", "/identification/absolute_orbit_number"),
            "boundingPolygon": mapped("h5", "/identification/bounding_polygon"),
            "burstID": mapped("h5", "/identification/burst_id"),
            "inputGranules": [
                mapped("h5", "/metadata/processing_information/inputs/l1_slc_files"),
            ],
            "instrumentName": mapped("h5", "/identification/instrument_name"),
            "isce3Version": mapped("h5", "/metadata/processing_information/algorithms/ISCE3_version"),
            "listOfPolarizations": [
                mapped("h5", "/metadata/processing_information/input_burst_metadata/polarization"),
            ],
            "lookDirection": mapped("h5", "/identification/look_direction"),
            "missionId": mapped("h5", "/identification/mission_id"),
            "orbitPassDirection": mapped("h5", "/identification/orbit_pass_direction"),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "./gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage/gmd:processStep[1]"
                    "/gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing/gmi:identifier/gmd:MD_Identifier"
                    "/gmd:code/gco:CharacterString"
                ),
            ),
            "productionDateTime": mapped("h5", "/identification/processing_date_time"),
            "productVersion": mapped("h5", "/identification/product_version"),
            "s1ReaderVersion": mapped("h5", "/metadata/processing_information/algorithms/s1_reader_version"),
            "softwareVersion": mapped("h5", "/metadata/processing_information/algorithms/COMPASS_version"),
            "trackNumber": mapped("h5", "/identification/track_number"),
        },
    }
)
