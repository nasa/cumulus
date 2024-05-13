import { deconstructCollectionId } from '@cumulus/message/Collections';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/field-mapping' });

// functions to map the api search string field name and value to postgres db field
const granuleMapping: { [key: string]: Function } = {
  beginningDateTime: (value?: string) => ({
    beginning_date_time: value,
  }),
  cmrLink: (value?: string) => ({
    cmr_link: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value,
  }),
  duration: (value?: string) => ({
    duration: value && Number(value),
  }),
  endingDateTime: (value?: string) => ({
    ending_date_time: value,
  }),
  granuleId: (value?: string) => ({
    granule_id: value,
  }),
  lastUpdateDateTime: (value?: string) => ({
    last_update_date_time: value,
  }),
  processingEndDateTime: (value?: string) => ({
    processing_end_date_time: value,
  }),
  processingStartDateTime: (value?: string) => ({
    processing_start_date_time: value,
  }),
  productionDateTime: (value?: string) => ({
    production_date_time: value,
  }),
  productVolume: (value?: string) => ({
    product_volume: value,
  }),
  published: (value?: string) => ({
    published: (value === 'true'),
  }),
  status: (value?: string) => ({
    status: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  timeToArchive: (value?: string) => ({
    time_to_archive: Number(value),
  }),
  timeToPreprocess: (value?: string) => ({
    time_to_process: Number(value),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value,
  }),
  // nested error field
  'error.Error': (value?: string) => ({
    'error.Error': value,
  }),
  // The following fields require querying other tables
  collectionId: (value?: string) => {
    const { name, version } = (value && deconstructCollectionId(value)) || {};
    return {
      collectionName: name,
      collectionVersion: version,
    };
  },
  provider: (value?: string) => ({
    providerName: value,
  }),
  pdrName: (value?: string) => ({
    pdrName: value,
  }),
};

// type and its mapping
const supportedMappings: { [key: string]: any } = {
  granule: granuleMapping,
};

/**
 * Map query string field to db field
 *
 * @param type - query record type
 * @param queryField - query field
 * @param queryField.name - query field value
 * @param [queryField.value] - query field value
 * @returns db field
 */
export const mapQueryStringFieldToDbField = (
  type: string,
  queryField: { name: string, value?: string }
): { [key: string]: any } | undefined => {
  if (!(supportedMappings[type] && supportedMappings[type][queryField.name])) {
    log.warn(`No db mapping field found for type: ${type}, field ${JSON.stringify(queryField)}`);
    return undefined;
  }
  return supportedMappings[type] && supportedMappings[type][queryField.name](queryField.value);
};
