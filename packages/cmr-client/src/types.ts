export type ConceptType = 'collections' | 'granules';

export interface CMRResponseBody {

}

export interface CMRErrorResponseBody {
  errors: {
    error?: string
  }
}
