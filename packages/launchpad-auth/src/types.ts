export interface LaunchpadTokenParams {
  api: string
  passphrase: string
  certificate: string
}

export interface GetTokenResponse {
  session_maxtimeout: number
  sm_token: string
}

export interface TokenObject extends GetTokenResponse {
  session_starttime: number
}

export interface ValidateTokenResponse {
  status: string
  session_maxtimeout: number
  session_starttime: number
  owner_auid: string
  owner_groups: string[]
}

export interface ValidateTokenResult {
  status: string
  message?: string
  session_maxtimeout?: number
  session_starttime?: number
  owner_auid?: string
}
