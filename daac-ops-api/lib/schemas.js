'use strict';

// fileType definition
const fileType = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Granule File Type',
  type: 'object',
  patternProperties: {
    '^[a-zA-Z\\-\\d]+$': {
      title: 'File Type Configuration',
      type: 'object',
      properties: {
        regex: {
          title: 'Regex',
          type: 'string'
        },
        sampleFileName: {
          title: 'Sample filename',
          type: 'string',
          description: 'Used for validating the regex rule'
        },
        access: {
          title: 'Access Level',
          type: 'string',
          enum: ['private', 'protected', 'public'],
          default: 'private'
        },
        source: {
          title: 'File source',
          type: 'string',
          enum: ['sips', 'cumulus']
        },
        archivedFile: {
          type: 'string',
          readonly: true
        },
        sipFile: {
          type: 'string',
          readonly: true
        },
        stagingFile: {
          type: 'string',
          readonly: true
        },
        name: {
          type: 'string',
          readonly: true
        },
        size: {
          type: 'number',
          readonly: true
        }
      },
      required: [
        'regex',
        'access',
        'source',
        'sampleFileName'
      ]
    }
  },
  additionalProperties: false
};

// granule definition
const granuleDefinition = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Granule Definition Object',
  description: 'Describes what constitutes a granule',
  type: 'object',
  properties: {
    granuleId: {
      title: 'Granule ID Validation Regex',
      description: 'This is used to validate an extracted granule ID',
      type: 'string'
    },
    granuleIdExtraction: {
      title: 'Granule ID Extraction Regex',
      description: 'This is used to extract the granule ID from filenames',
      type: 'string'
    },
    sampleFileName: {
      title: 'Sample filename',
      description: 'This filename is used to test regex extraction and validation rules',
      type: 'string'
    },
    files: fileType,
    neededForProcessing: {
      title: 'Files Required for Processing to Start',
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },
  required: [
    'granuleId',
    'files',
    'granuleIdExtraction',
    'sampleFileName',
    'neededForProcessing'
  ]
};

// recipe definition
const recipe = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Recipe for collections',
  type: 'object',
  properties: {
    order: {
      title: 'Order of Recipe Steps',
      type: 'array',
      items: {
        type: 'string'
      }
    },
    processStep: {
      type: 'object',
      title: 'Processing Step',
      properties: {
        description: {
          type: 'string'
        },
        config: {
          type: 'object',
          title: 'Configuration',
          properties: {
            image: {
              type: 'string',
              title: 'TaskDefinition Image',
              enum: ['asterProcessing', 'modisProcessing']
            },
            inputFiles: {
              type: 'array',
              minItems: 1
            },
            outputFiles: {
              type: 'array',
              minItems: 1
            }
          },
          required: [
            'image',
            'inputFiles',
            'outputFiles'
          ]
        }
      },
      required: ['config']
    },
    archive: {
      type: 'object',
      title: 'Archive step',
      properties: {
        config: {
          type: 'object'
        }
      }
    },
    cmr: {
      type: 'object',
      title: 'CMR step',
      properties: {
        config: {
          type: 'object'
        }
      }
    }
  },
  required: [
    'order',
    'processStep',
    //'archive',
    //'cmr'
  ]
};

// Collection Record Definition
module.exports.collection = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Collection Object',
  description: 'Cumulus-api Collection Table schema',
  type: 'object',
  properties: {
    collectionName: {
      title: 'Collection Name',
      type: 'string'
    },
    granuleDefinition: granuleDefinition,
    cmrProvider: {
      title: 'CMR Provider, e.g. CUMULUS',
      type: 'string',
      default: 'LPCUMULUS'
    },
    providers: {
      title: 'Providers',
      description: 'Provider names associated with this collection',
      type: 'array',
      items: {
        type: 'string'
      }
    },
    recipe: recipe,
    createdAt: {
      type: 'number',
      readonly: true
    },
    updatedAt: {
      type: 'number',
      readonly: true
    },
    changedBy: {
      type: 'string',
      readonly: true
    }
  },
  required: [
    'collectionName',
    'granuleDefinition',
    'recipe',
    'createdAt',
    'updatedAt'
  ]
};

// Granule Record Schema
module.exports.granule = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Granule Object',
  type: 'object',
  properties: {
    granuleId: {
      title: 'Granule ID',
      type: 'string',
      readonly: true
    },
    collectionName: {
      type: 'string',
      readonly: true
    },
    pdrName: {
      type: 'string',
      readonly: true
    },
    provider: {
      type: 'string',
      readonly: true
    },
    conceptId: {
      type: 'string',
      readonly: true
    },
    status: {
      type: 'string',
      enum: ['ingesting', 'duplicate', 'processing', 'archiving', 'cmr', 'completed', 'failed'],
      default: 'ingesting',
      readonly: true
    },
    cmrLink: {
      type: 'string',
      readonly: true
    },
    files: fileType,
    recipe: recipe,
    published: {
      type: 'boolean',
      default: false,
      description: 'shows whether the granule is published to CMR',
      readonly: true
    },
    readyForProcess: {
      type: 'number',
      readonly: true
    },
    error: {
      type: 'string',
      readonly: true
    },
    errorType: {
      type: 'string',
      description: 'Type of the error which could either be ingest or processing',
      enum: ['ingest', 'processing'],
      readonly: true
    },
    processedAt: {
      type: 'number',
      readonly: true
    },
    pushedToCMRAt: {
      type: 'number',
      readonly: true
    },
    archivedAt: {
      type: 'number',
      readonly: true
    },
    createdAt: {
      type: 'number',
      readonly: true
    },
    updatedAt: {
      type: 'number',
      readonly: true
    }
  },
  required: [
    'granuleId',
    'status',
    'collectionName',
    'pdrName',
    'provider',
    'recipe',
    'published',
    'createdAt',
    'updatedAt'
  ]
};

// Invoke Record Schema
module.exports.invoke = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Invoke Record Object',
  type: 'object',
  properties: {
    collectionName: {
      type: 'string'
    },
    invokeSchedule: {
      type: 'string'
    },
    invokedAt: {
      type: 'number'
    },
    createdAt: {
      type: 'number'
    },
    updatedAt: {
      type: 'number'
    }
  }
};

// PDR Record Schema
module.exports.pdr = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'PDR Record Object',
  type: 'object',
  properties: {
    pdrName: {
      title: 'PDR Name',
      type: 'string',
      readonly: true
    },
    provider: {
      title: 'Provider Name',
      type: 'string',
      readonly: true
    },
    isActive: {
      type: 'boolean',
      default: true,
      readonly: true
    },
    status: {
      type: 'string',
      enum: ['discovered', 'parsed', 'completed', 'failed'],
      default: 'discovered',
      readonly: true
    },
    granulesCount: {
      type: 'number',
      description: 'Number of granules included in the PDR',
      readonly: true
    },
    address: {
      type: 'string',
      readonly: true
    },
    originalUrl: {
      type: 'string',
      readonly: true
    },
    completedAt: {
      type: 'number',
      readonly: true
    },
    parsedAt: {
      type: 'number',
      readonly: true
    },
    createdAt: {
      type: 'number',
      readonly: true
    },
    updatedAt: {
      type: 'number',
      readonly: true
    }
  },
  required: [
    'pdrName',
    'provider',
    'status',
    'originalUrl',
    'createdAt',
    'updatedAt'
  ]
};

// Payload Schema (payload is the message sent to dispatcher)
module.exports.payload = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Payload object',
  type: 'object',
  properties: {
    previousStep: {
      type: 'number',
      default: 0
    },
    nextStep: {
      type: 'number',
      default: 0
    },
    granuleRecord: module.exports.granule
  }
};

// Provider Schema => the model keeps information about each ingest location
module.exports.provider = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Provider Object',
  description: 'Keep the information about each ingest endpoint',
  type: 'object',
  properties: {
    name: {
      title: 'Title',
      description: 'A title for the provider record',
      type: 'string',
      pattern: '^([\\w\\d_\\-]*)$'
    },
    providerName: {
      title: 'Provider, e.g. MODAPS',
      description: 'Name of the SIP',
      type: 'string'
    },
    protocol: {
      title: 'Protocol',
      type: 'string',
      enum: ['http', 'ftp'],
      default: 'http'
    },
    host: {
      title: 'Host',
      type: 'string'
    },
    path: {
      title: 'Path to the PDR/files folder',
      type: 'string'
    },
    panFolder: {
      title: 'Folder to store PAN messages',
      type: 'string'
    },
    config: {
      title: 'Configuration',
      type: 'object',
      properties: {
        username: {
          type: 'string'
        },
        password: {
          type: 'string'
        },
        port: {
          type: 'string'
        }
      }
    },
    status: {
      title: 'Status',
      type: 'string',
      enum: ['ingesting', 'stopped', 'failed'],
      default: 'stopped',
      readonly: true
    },
    isActive: {
      title: 'Is Active?',
      type: 'boolean',
      default: false,
      readonly: true
    },
    regex: {
      type: 'object',
      patternProperties: {
        '^([\\S]*)$': {
          type: 'string'
        }
      },
      readonly: true
    },
    lastTimeIngestedAt: {
      title: 'Last Time Ingest from the Provider',
      type: 'number',
      readonly: true
    },
    createdAt: {
      type: 'number',
      readonly: true
    },
    updatedAt: {
      type: 'number',
      readonly: true
    }
  },
  required: [
    'name', 'providerName', 'protocol', 'host', 'path',
    'isActive', 'status', 'createdAt', 'updatedAt'
  ]
};

