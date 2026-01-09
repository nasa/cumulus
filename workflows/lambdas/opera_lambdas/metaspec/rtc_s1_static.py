from mandible.metadata_mapper.builder import build, mapped, reformatted

SOURCES = {
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


def _iso_additional_attribute_key(name: str) -> str:
    return (
        "./gmd:contentInfo/gmd:MD_CoverageDescription/gmd:dimension/gmd:MD_Band/gmd:otherProperty/"
        "gco:Record/eos:AdditionalAttributes/eos:AdditionalAttribute[eos:reference/"
        f"eos:EOS_AdditionalAttributeDescription/eos:name/gco:CharacterString='{name}']/"
        "eos:value/gco:CharacterString"
    )


_ISO_GEOGRAPHIC_BOUNDING_BOX = (
    "./gmd:identificationInfo/gmd:MD_DataIdentification/gmd:extent/gmd:EX_Extent/gmd:geographicElement/"
    "gmd:EX_GeographicBoundingBox"
)


TEMPLATE = build(
    {
        "ProductMd": {
            "absoluteOrbitNumber": mapped("iso.xml", _iso_additional_attribute_key("AbsoluteOrbitNumber")),
            "acquisitionMode": mapped("iso.xml", _iso_additional_attribute_key("AcquisitionMode")),
            "beamID": mapped("iso.xml", _iso_additional_attribute_key("SubSwathID")),
            "bistaticDelayCorrectionApplied": mapped(
                "iso.xml",
                _iso_additional_attribute_key("BistaticDelayCorrectedApplied"),
            ),
            "boundEast": mapped("iso.xml", _ISO_GEOGRAPHIC_BOUNDING_BOX + "/gmd:eastBoundLongitude"),
            "boundNorth": mapped("iso.xml", _ISO_GEOGRAPHIC_BOUNDING_BOX + "/gmd:northBoundLatitude"),
            "boundSouth": mapped("iso.xml", _ISO_GEOGRAPHIC_BOUNDING_BOX + "/gmd:southBoundLatitude"),
            "boundWest": mapped("iso.xml", _ISO_GEOGRAPHIC_BOUNDING_BOX + "/gmd:westBoundLongitude"),
            "burstID": mapped("iso.xml", _iso_additional_attribute_key("BurstID")),
            "inputGranules": reformatted(
                format="Json",
                value=mapped("iso.xml", _iso_additional_attribute_key("L1SlcGranules")),
                key="$",
            ),
            "instrumentName": mapped("iso.xml", _iso_additional_attribute_key("InstrumentName")),
            "isce3Version": mapped("iso.xml", _iso_additional_attribute_key("ISCEVersion")),
            "listOfPolarizations": reformatted(
                format="Json",
                value=mapped("iso.xml", _iso_additional_attribute_key("ListOfPolarizations")),
                key="$",
            ),
            "lookDirection": mapped("iso.xml", _iso_additional_attribute_key("LookDirection")),
            "orbitPassDirection": mapped("iso.xml", _iso_additional_attribute_key("OrbitPassDirection")),
            "pgeVersionString": mapped(
                "iso.xml",
                (
                    "./gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage/gmd:LI_Lineage/gmd:processStep/"
                    "gmi:LE_ProcessStep/gmi:processingInformation/eos:EOS_Processing/gmi:identifier/"
                    "gmd:MD_Identifier/gmd:code/gco:CharacterString"
                ),
            ),
            "platform": mapped("iso.xml", _iso_additional_attribute_key("Platform")),
            "productionDateTime": mapped("iso.xml", _iso_additional_attribute_key("ProcessingDatetime")),
            "productVersion": mapped("iso.xml", _iso_additional_attribute_key("ProductVersion")),
            "s1ReaderVersion": mapped("iso.xml", _iso_additional_attribute_key("S1ReaderVersion")),
            "softwareVersion": mapped("iso.xml", _iso_additional_attribute_key("SoftwareVersion")),
            "staticTroposphericGeolocationCorrectionApplied": mapped(
                "iso.xml",
                _iso_additional_attribute_key("StaticTroposphericGeolocationCorrectedApplied"),
            ),
            "trackNumber": mapped("iso.xml", _iso_additional_attribute_key("TrackNumber")),
            "wetTroposphericGeolocationCorrectionApplied": mapped(
                "iso.xml",
                _iso_additional_attribute_key("WetTroposphericGeolocationCorrectionApplied"),
            ),
        },
    }
)
