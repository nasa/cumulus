export type ConceptType = 'collection' | 'collections' | 'granule' | 'granules';

export interface CMRResponseBody {

}

export interface CMRErrorResponseBody {
  errors: {
    error?: string
  }
}
