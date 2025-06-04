// Implementation against https://git.earthdata.nasa.gov/projects/EMFD/repos/unified-metadata-model/browse/granule/v1.6.6/umm-g-json-schema.json
type UMMGGranule = {
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
};

function isUMMGGranule(obj: any): obj is UMMGGranule {
  return typeof obj === 'object' && obj !== null && typeof obj.GranuleUR === 'string';
}

/**
 * Updates a UMM-G metadata object with a new GranuleUR and ProducerGranuleId.
 *
 * This function:
 * - Validates that the input is a valid UMM-G granule metadata object.
 * - Performs a deep clone to preserve the original input.
 * - Sets the GranuleUR to the specified value.
 * - Ensures that the DataGranule.Identifiers array exists.
 * - Adds or updates an entry of type "ProducerGranuleId" with the provided identifier.
 *
 * @param metadataObject - The parsed UMM-G metadata object to be modified.
 * @param granuleUr - The new GranuleUR value to assign.
 * @param producerGranuleId - The ProducerGranuleId to store in the Identifiers list.
 * @returns A deep-cloned and updated copy of the UMM-G metadata object.
 * @throws If the input does not match the expected UMM-G granule structure.
 */

export function updateUMMGGranuleURAndGranuleIdentifier({
  metadataObject,
  granuleUr,
  producerGranuleId,
}: {
  metadataObject: unknown;
  granuleUr: string;
  producerGranuleId: string;
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

  const producerGranuleIdIdentifier = {
    Identifier: producerGranuleId,
    IdentifierType: 'ProducerGranuleId',
  };

  if (producerIndex !== -1) {
    moddedJson.DataGranule.Identifiers[producerIndex] = producerGranuleIdIdentifier;
  } else {
    moddedJson.DataGranule.Identifiers.push(producerGranuleIdIdentifier);
  }

  return moddedJson;
}
