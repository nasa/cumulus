export interface LaunchpadTokenParams {
  api: string
  passphrase: string
  certificate: string
}

export interface LaunchpadTokenResponse {
  session_maxtimeout: number
  sm_token: string
}

export interface LaunchpadTokenObject extends LaunchpadTokenResponse {
  session_starttime: number
}
