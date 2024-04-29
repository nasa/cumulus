export interface QueryStringParameters {
  limit?: string,
  page?: string,
  [key: string]: string | string[] | undefined,
}

export interface QueryEvent {
  queryStringParameters?: QueryStringParameters,
}

export interface ParsedQueryParameters {
  limit?: number,
  offset?: number,
  page?: number,
}
