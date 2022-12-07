import { Response } from 'got';
export type ConceptType = 'collection' | 'collections' | 'granule' | 'granules';

export interface CMRResponseBody {

}

export interface CMRErrorResponseBody {
  errors: {
    error?: string
  }
}

export type EarthdataGetTokenResponse = Response<{
  body: {
    access_token?: string,
    token_type?: string,
    expiration_date?: string
  }
}>;

export type EarthdataPostTokenResponse = Response<{
  body: {
    access_token?: string,
    expiration_date?: string
  }
}>;
