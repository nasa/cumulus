import { deconstructCollectionId } from '@cumulus/message/Collections';

// mapping the api granule search fields to postgres db fields
const granuleMapping: any = {
  beginningDateTime: (value: string) => ({
    beginning_date_time: value,
  }),
  cmrLink: (value: string) => ({
    cmr_link: value,
  }),
  createdAt: (value: string) => ({
    created_at: new Date(Number(value)),
  }),
  duration: (value: string) => ({
    duration: Number(value),
  }),
  endingDateTime: (value: string) => ({
    ending_date_time: value,
  }),
  granuleId: (value: string) => ({
    granule_id: value,
  }),
  lastUpdateDateTime: (value: string) => ({
    last_update_date_time: value,
  }),
  processingEndDateTime: (value: string) => ({
    processing_end_date_time: value,
  }),
  processingStartDateTime: (value: string) => ({
    processing_start_date_time: value,
  }),
  productionDateTime: (value: string) => ({
    production_date_time: value,
  }),
  productVolume: (value: string) => ({
    product_volume: Number(value),
  }),
  published: (value: string) => ({
    published: value,
  }),
  status: (value: string) => ({
    status: value,
  }),
  timestamp: (value: string) => ({
    timestamp: new Date(Number(value)),
  }),
  timeToArchive: (value: string) => ({
    time_to_archive: Number(value),
  }),
  timeToPreprocess: (value: string) => ({
    time_to_process: Number(value),
  }),
  updatedAt: (value: string) => ({
    updated_at: new Date(Number(value)),
  }),
  // The following fields require querying other tables
  collectionId: (value: string) => {
    const { name, version } = deconstructCollectionId(value);
    return {
      collectionName: name,
      collectionVersion: version,
    };
  },
  provider: (value: string) => ({
    providerName: value,
  }),
  pdrName: (value: string) => ({
    pdrName: value,
  }),
};

const supportedMappings = {
  granule: granuleMapping,
};

const buildTerm = (type: string, dbQueryParameters: DbQueryParameters, queryFields: any, regex: any)
  : DbQueryParameters => {
  const termFields = dbQueryParameters.termFields ?? [];
  queryFields.map((field: any) => {
    const fieldName = field.name.match(regex)[1];
    if (granuleMapping[fieldName]) {
      const queryParam = granuleMapping[fieldName](field.value);
      termFields.push(queryParam);
      return queryParam;
    }
    console.log(fieldName, 'is not querable');
    return undefined;
  });
  return { ...dbQueryParameters, termFields };
};
