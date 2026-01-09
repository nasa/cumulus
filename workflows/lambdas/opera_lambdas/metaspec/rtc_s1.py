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
                "fileName": r".*\.iso\.xml",
                "type": "metadata",
            },
        },
        "format": {"class": "Xml"},
    },
}

TEMPLATE = build(
    {
        "ProductMd": {
            "absoluteOrbitNumber": mapped("h5", "/identification/absoluteOrbitNumber"),
            "acquisitionMode": mapped("h5", "/identification/acquisitionMode"),
            "beamID": mapped("h5", "/identification/subSwathID"),
            "bistaticDelayCorrectionApplied": mapped(
                "h5",
                "/metadata/processingInformation/parameters/bistaticDelayCorrectionApplied",
            ),
            "boundingPolygon": mapped("h5", "/identification/boundingPolygon"),
            "burstID": mapped("h5", "/identification/burstID"),
            "filteringApplied": mapped("h5", "/metadata/processingInformation/parameters/filteringApplied"),
            "inputGranules": mapped("h5", "/metadata/processingInformation/inputs/l1SlcGranules"),
            "instrumentName": mapped("h5", "/identification/instrumentName"),
            "isce3Version": mapped("h5", "/metadata/processingInformation/algorithms/isce3Version"),
            "listOfPolarizations": mapped("h5", "/data/listOfPolarizations"),
            "lookDirection": mapped("h5", "/identification/lookDirection"),
            "noiseCorrectionApplied": mapped(
                "h5",
                "/metadata/processingInformation/parameters/noiseCorrectionApplied",
            ),
            "orbitPassDirection": mapped("h5", "/identification/orbitPassDirection"),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "./gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage/gmd:processStep/"
                    "gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing/gmi:identifier/"
                    "gmd:MD_Identifier/gmd:code/gco:CharacterString"
                ),
            ),
            "platform": mapped("h5", "/identification/platform"),
            "productionDateTime": mapped("h5", "/identification/processingDateTime"),
            "productVersion": mapped("h5", "/identification/productVersion"),
            "radiometricTerrainCorrectionApplied": mapped(
                "h5",
                "/metadata/processingInformation/parameters/radiometricTerrainCorrectionApplied",
            ),
            "s1ReaderVersion": mapped("h5", "/metadata/processingInformation/algorithms/s1ReaderVersion"),
            "softwareVersion": mapped("h5", "/metadata/processingInformation/algorithms/softwareVersion"),
            "staticTroposphericGeolocationCorrectionApplied": mapped(
                "h5",
                "/metadata/processingInformation/parameters/staticTroposphericGeolocationCorrectionApplied",
            ),
            "trackNumber": mapped("h5", "/identification/trackNumber"),
            "wetTroposphericGeolocationCorrectionApplied": mapped(
                "h5",
                "/metadata/processingInformation/parameters/wetTroposphericGeolocationCorrectionApplied",
            ),
            "zeroDopplerEndTime": mapped("h5", "/identification/zeroDopplerEndTime"),
            "zeroDopplerStartTime": mapped("h5", "/identification/zeroDopplerStartTime"),
        },
    }
)
