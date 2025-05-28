interface Echo10XmlBaseGranule {
  Granule: {
    GranuleUR?: string;
    DataGranule?: {
      ProducerGranuleId?: string;
    }
    [key: string]: unknown;
  };
}

function isEcho10XmlBaseGranule(obj: any): obj is Echo10XmlBaseGranule {
  return typeof obj === 'object' && obj !== null
    && obj.Granule?.GranuleUR !== undefined;
}

export function updateEcho10XMLGranuleUrAndGranuleIdentifier({
  xml, // The parsed XML object (e.g., from xml2js)
  granuleUr, // The new GranuleUR value
  identifier, // The original identifier to store
}: {
  xml: unknown;
  granuleUr: string;
  identifier: string;
}): any {
  if (!isEcho10XmlBaseGranule(xml)) {
    throw new Error('Invalid XML input - expected an object with GranuleUR');
  }

  const moddedXml = structuredClone(xml);

  moddedXml.Granule ??= {};
  moddedXml.Granule.GranuleUR = granuleUr;
  moddedXml.Granule.DataGranule ??= {};
  moddedXml.Granule.DataGranule.ProducerGranuleId = identifier;

  return moddedXml;
}
