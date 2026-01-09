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


TEMPLATE = build(
    {
        "ProductMd": {
            "beginDateTime": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:temporalElement/gmd:EX_TemporalExtent/gmd:extent/gml:TimePeriod/gml:beginPosition"
                ),
            ),
            "boundEast": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:geographicElement/gmd:EX_GeographicBoundingBox/gmd:eastBoundLongitude/gco:Decimal"
                ),
            ),
            "boundNorth": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:geographicElement/gmd:EX_GeographicBoundingBox/gmd:northBoundLatitude/gco:Decimal"
                ),
            ),
            "boundSouth": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:geographicElement/gmd:EX_GeographicBoundingBox/gmd:southBoundLatitude/gco:Decimal"
                ),
            ),
            "boundWest": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:geographicElement/gmd:EX_GeographicBoundingBox/gmd:westBoundLongitude/gco:Decimal"
                ),
            ),
            "endDateTime": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent"
                    "/gmd:temporalElement/gmd:EX_TemporalExtent/gmd:extent/gml:TimePeriod/gml:endPosition"
                ),
            ),
            "inputGranules": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage"
                    "/gmd:LI_Lineage/gmd:source/gmi:LE_Source/gmd:sourceCitation/gmd:CI_Citation/gmd:title/gmx:FileName"
                ),
            ),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage"
                    "/gmd:processStep/gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing"
                    "/gmi:identifier/gmd:MD_Identifier/gmd:code/gco:CharacterString"
                ),
            ),
            "productionDateTime": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage"
                    "/gmd:processStep/gmi:LE_ProcessStep/gmd:dateTime/gco:DateTime"
                ),
            ),
            "sasVersionId": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:citation"
                    "/gmd:CI_Citation/gmd:edition/gco:CharacterString"
                ),
                return_list=True,
            ),
        },
    }
)
