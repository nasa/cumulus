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
    created_at: value && new Date(Number(value)),
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
  _id: (value?: string) => ({
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
    updated_at: value && new Date(Number(value)),
  }),
  error: (value?: string) => ({
    error: value,
  }),
  // nested error field
  'error.Error': (value?: string) => ({
    'error.Error': value,
  }),
  'error.Error.keyword': (value?: string) => ({
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

const asyncOperationMapping : { [key: string]: Function } = {
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  id: (value?: string) => ({
    id: value,
  }),
  _id: (value?: string) => ({
    id: value,
  }),
  operationType: (value?: string) => ({
    operation_type: value,
  }),
  status: (value?: string) => ({
    status: value,
  }),
  taskArn: (value?: string) => ({
    task_arn: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
};

const collectionMapping : { [key: string]: Function } = {
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  name: (value?: string) => ({
    name: value,
  }),
  version: (value?: string) => ({
    version: value,
  }),
  _id: (value?: string) => {
    const { name, version } = (value && deconstructCollectionId(value)) || {};
    return {
      collectionName: name,
      collectionVersion: version,
    };
  },
  duplicateHandling: (value?: string) => ({
    duplicate_handling: value,
  }),
  granuleId: (value?: string) => ({
    granule_id_validation_regex: value,
  }),
  granuleIdExtraction: (value?: string) => ({
    granule_id_extraction_regex: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  reportToEms: (value?: string) => ({
    report_to_ems: (value === 'true'),
  }),
  process: (value?: string) => ({
    process: value,
  }),
  sampleFileName: (value?: string) => ({
    sample_file_name: value,
  }),
  url_path: (value?: string) => ({
    url_path: value,
  }),
};

const executionMapping : { [key: string]: Function } = {
  arn: (value?: string) => ({
    arn: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  duration: (value?: string) => ({
    duration: value && Number(value),
  }),
  // nested error field
  'error.Error': (value?: string) => ({
    'error.Error': value,
  }),
  'error.Error.keyword': (value?: string) => ({
    'error.Error': value,
  }),
  execution: (value?: string) => ({
    url: value,
  }),
  type: (value?: string) => ({
    workflow_name: value,
  }),
  status: (value?: string) => ({
    status: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  // The following fields require querying other tables
  asyncOperationId: (value?: string) => ({
    asyncOperationId: value,
  }),
  parentArn: (value?: string) => ({
    parentArn: value,
  }),
  collectionId: (value?: string) => {
    const { name, version } = (value && deconstructCollectionId(value)) || {};
    return {
      collectionName: name,
      collectionVersion: version,
    };
  },
};

const pdrMapping : { [key: string]: Function } = {
  address: (value?: string) => ({
    address: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  duration: (value?: string) => ({
    duration: value && Number(value),
  }),
  originalUrl: (value?: string) => ({
    original_url: value,
  }),
  PANSent: (value?: string) => ({
    pan_sent: (value === 'true'),
  }),
  PANmessage: (value?: string) => ({
    pan_message: value,
  }),
  pdrName: (value?: string) => ({
    name: value,
  }),
  progress: (value?: string) => ({
    progress: value && Number(value),
  }),
  status: (value?: string) => ({
    status: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
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
  execution: (value?: string) => ({
    executionArn: value && value.split('/').pop(),
  }),
};

const providerMapping : { [key: string]: Function } = {
  allowedRedirects: (value?: string) => ({
    allowed_redirects: value?.split(','),
  }),
  certificateUrl: (value?: string) => ({
    certificate_url: value,
  }),
  cmKeyId: (value?: string) => ({
    cm_key_id: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  id: (value?: string) => ({
    name: value,
  }),
  name: (value?: string) => ({
    name: value,
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  globalConnectionLimit: (value?: string) => ({
    global_connection_limit: value && Number(value),
  }),
  host: (value?: string) => ({
    host: value,
  }),
  password: (value?: string) => ({
    password: value,
  }),
  port: (value?: string) => ({
    port: value,
  }),
  privateKey: (value?: string) => ({
    private_key: value,
  }),
  protocol: (value?: string) => ({
    protocol: value,
  }),
  username: (value?: string) => ({
    username: value,
  }),
};

const ruleMapping : { [key: string]: Function } = {
  arn: (value?: string) => ({
    arn: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  name: (value?: string) => ({
    name: value,
  }),
  state: (value?: string) => ({
    enabled: (value === 'ENABLED'),
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  workflow: (value?: string) => ({
    workflow: value,
  }),
  logEventArn: (value?: string) => ({
    log_event_arn: value,
  }),
  executionNamePrefix: (value?: string) => ({
    execution_name_prefix: value,
  }),
  queueUrl: (value?: string) => ({
    queue_url: value,
  }),
  'rule.type': (value?: string) => ({
    type: value,
  }),
  'rule.value': (value?: string) => ({
    value: value,
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
};

const reconciliationReportMapping: { [key: string]: Function } = {
  name: (value?: string) => ({
    name: value,
  }),
  type: (value?: string) => ({
    type: value,
  }),
  status: (value?: string) => ({
    status: value,
  }),
  location: (value?: string) => ({
    location: value,
  }),
  error: (value?: string) => ({
    error: value,
  }),
  createdAt: (value?: string) => ({
    created_at: value && new Date(Number(value)),
  }),
  updatedAt: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
  timestamp: (value?: string) => ({
    updated_at: value && new Date(Number(value)),
  }),
};

// type and its mapping
const supportedMappings: { [key: string]: any } = {
  granule: granuleMapping,
  asyncOperation: asyncOperationMapping,
  collection: collectionMapping,
  execution: executionMapping,
  pdr: pdrMapping,
  provider: providerMapping,
  rule: ruleMapping,
  reconciliationReport: reconciliationReportMapping,
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
