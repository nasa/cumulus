// Implementation against https://git.earthdata.nasa.gov/projects/EMFD/repos/unified-metadata-model/browse/granule/v1.6.6/umm-g-json-schema.json

interface UMMGGranule {
  GranuleUR: string;
  DataGranule?: {
    Identifiers?: {
      Identifier: string;
      IdentifierType: string;
      IdentifierName?: string;
    }[];
    [key: string]: any;
  };
  [key: string]: unknown;
}

function isUMMGGranule(obj: any): obj is UMMGGranule {
  return typeof obj === 'object' && obj !== null && typeof obj.GranuleUR === 'string';
}

export function updateUMMGGranuleURAndGranuleIdentifier({
  metadataObject,
  granuleUr,
  identifier,
}: {
  metadataObject: unknown;
  granuleUr: string;
  identifier: string;
}): UMMGGranule {
  if (!isUMMGGranule(metadataObject)) {
    throw new Error('Invalid UMM-G JSON metadata');
  }

  const moddedJson = structuredClone(metadataObject);

  moddedJson.GranuleUR = granuleUr;
  moddedJson.DataGranule ??= {};
  moddedJson.DataGranule.Identifiers ??= [];

  const producerIndex = moddedJson.DataGranule.Identifiers.findIndex(
    (id) => id.IdentifierType === 'ProducerGranuleId'
  );

  const producerGranuleId = {
    Identifier: identifier,
    IdentifierType: 'ProducerGranuleId',
  };

  if (producerIndex !== -1) {
    moddedJson.DataGranule.Identifiers[producerIndex] = producerGranuleId;
  } else {
    moddedJson.DataGranule.Identifiers.push(producerGranuleId);
  }

  return moddedJson;
}
