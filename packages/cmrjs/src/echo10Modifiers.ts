interface Echo10XmlBaseGranule {
  Granule: {
    GranuleUR?: string;
    DataGranule?: {
      Identifiers?: {
        IdentifierType?: string;
        Identifier?: string;
      }[];
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

  // Update the top-level GranuleUR
  moddedXml.Granule ??= {};
  moddedXml.Granule.GranuleUR = granuleUr;
  moddedXml.Granule.DataGranule ??= {};
  const dataGranule = moddedXml.Granule.DataGranule;

  // Ensure Identifiers structure exists
  dataGranule.Identifiers = dataGranule.Identifiers || [];

  // Add the ProducerGranuleId entry (overwrite if one already exists)
  const producerIdIndex = dataGranule.Identifiers.findIndex(
    (idObj: any) => idObj.IdentifierType?.[0] === 'ProducerGranuleId'
  );
  const newIdentifier = {
    Identifier: identifier,
    IdentifierType: 'ProducerGranuleId',
  };

  if (producerIdIndex !== -1) {
    dataGranule.Identifiers[producerIdIndex] = newIdentifier;
  } else {
    dataGranule.Identifiers.push(newIdentifier);
  }
  return moddedXml;
}
