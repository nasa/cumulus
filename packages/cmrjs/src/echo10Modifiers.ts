type Echo10XmlBaseGranule = {
  Granule: {
    GranuleUR?: string;
    DataGranule?: {
      ProducerGranuleId?: string;
    }
    [key: string]: unknown;
  };
};

function isEcho10XmlBaseGranule(obj: any): obj is Echo10XmlBaseGranule {
  return typeof obj === 'object' && obj !== null
    && obj.Granule?.GranuleUR !== undefined;
}

/**
 * Updates an ECHO10 metadata XML object with a new GranuleUR and ProducerGranuleId.
 *
 * This function:
 * - Validates that the input is a minimally valid ECHO10 metadata object.
 * - Performs a deep clone to avoid mutating the original input.
 * - Sets the new `GranuleUR` and `ProducerGranuleId` values accordingly.
 *
 * @param params
 * @param params.xml - The parsed XML object (e.g., from xml2js) representing ECHO10 metadata.
 * @param params.granuleUr - The new GranuleUR value to apply to the metadata.
 * @param params.producerGranuleId - The original identifier value to be set as ProducerGranuleId.
 * @returns A deep-cloned and updated copy of the original ECHO10 metadata object.
 * @throws If the input object does not conform to the expected ECHO10 structure.
 */
export function updateEcho10XMLGranuleUrAndGranuleIdentifier({
  xml, // The parsed XML object (e.g., from xml2js)
  granuleUr, // The new GranuleUR value
  producerGranuleId, // The original identifier to store
}: {
  xml: unknown;
  granuleUr: string;
  producerGranuleId: string;
}): any {
  if (!isEcho10XmlBaseGranule(xml)) {
    throw new Error('Invalid XML input - expected an object with GranuleUR');
  }

  const moddedXml = structuredClone(xml);

  moddedXml.Granule ??= {};
  moddedXml.Granule.GranuleUR = granuleUr;
  moddedXml.Granule.DataGranule ??= {};
  moddedXml.Granule.DataGranule.ProducerGranuleId = producerGranuleId;

  return moddedXml;
}
