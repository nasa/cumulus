from mandible.metadata_mapper.builder import build

SOURCES = {}


TEMPLATE = build(
    {
        "ProductMd": {
            "boundingPolygon": (
                "POLYGON ((-92.24415082988388 38.56710929502656, -92.22538626325654 38.74110332857268,"
                " -92.28291754935826 38.73294800244953, -92.24415082988388 38.56710929502656))"
            ),
            "productionDateTime": "2023-09-07T00:31:01.000000Z",
        },
    }
)
