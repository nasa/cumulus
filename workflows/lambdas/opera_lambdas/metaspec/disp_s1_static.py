from mandible.metadata_mapper.builder import build, mapped

SOURCES = {
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


def _iso_additional_attribute_key(name: str) -> str:
    return (
        "/gmi:MI_Metadata/gmd:contentInfo/gmd:MD_CoverageDescription/gmd:dimension/gmd:MD_Band/gmd:otherProperty"
        "/gco:Record/eos:AdditionalAttributes/eos:AdditionalAttribute[eos:reference"
        f"/eos:EOS_AdditionalAttributeDescription/eos:name/gco:CharacterString='{name}']/eos:value/gco:CharacterString"
    )


def _iso_identifier_key(name: str) -> str:
    return (
        "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:citation/gmd:CI_Citation/gmd:identifier/"
        f"gmd:MD_Identifier[gmd:description/gco:CharacterString='{name}']/gmd:code/gco:CharacterString"
    )


TEMPLATE = build(
    {
        "ProductMd": {
            "acquisitionMode": mapped("iso.xml", _iso_additional_attribute_key("AcquisitionMode")),
            "ascendingDescending": mapped("iso.xml", _iso_additional_attribute_key("OrbitDirection")),
            "boundingPolygon": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent"
                    "/gmd:EX_Extent/gmd:geographicElement/gmd:EX_BoundingPolygon/gmd:polygon"
                    "/gml:Polygon/gml:exterior/gml:LinearRing/gml:posList"
                ),
            ),
            "frameNumber": mapped("iso.xml", _iso_additional_attribute_key("FrameID")),
            "instrumentName": mapped("iso.xml", _iso_additional_attribute_key("InstrumentName")),
            "lookDirection": mapped("iso.xml", _iso_additional_attribute_key("LookDirection")),
            "pathNumber": mapped("iso.xml", _iso_additional_attribute_key("TrackNumber")),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage"
                    "/gmd:processStep/gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing/gmi:identifier"
                    "/gmd:MD_Identifier/gmd:code/gco:CharacterString"
                ),
            ),
            "producerGranuleId": mapped("iso.xml", _iso_identifier_key("ProducerGranuleId")),
            "productVersion": mapped("iso.xml", _iso_additional_attribute_key("ProductVersion")),
            "productionDateTime": mapped(
                "iso.xml",
                (
                    "/gmi:MI_Metadata/gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage"
                    "/gmd:processStep/gmi:LE_ProcessStep[gmd:description/gco:CharacterString='ProductionDateTime']"
                    "/gmd:dateTime/gco:DateTime"
                ),
            ),
            "sasVersionId": mapped("iso.xml", _iso_identifier_key("OtherId: SASVersionId")),
        },
    }
)
