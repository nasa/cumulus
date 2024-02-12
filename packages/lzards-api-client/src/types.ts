export interface LzardsApiGetRequestParameters {
  searchParams: object,
  getAuthTokenFunction?: () => Promise<string>,
}
