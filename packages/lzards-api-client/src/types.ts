export interface LzardsApiGetRequestParameters {
  lzardsApiUri?: string,
  searchParams: object,
  getAuthTokenFunction?: () => Promise<string>,
}
