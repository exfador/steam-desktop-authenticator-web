import { packMessage, unpackMessage } from './wire.js';
import { sendVia } from './netgate.js';

const API = 'https://api.steampowered.com';

export const MSG = {
  GetPasswordRSAPublicKey_Request: { accountName: { id: 1, type: 'string' } },
  GetPasswordRSAPublicKey_Response: {
    publicKeyMod: { id: 1, type: 'string' },
    publicKeyExp: { id: 2, type: 'string' },
    timestamp: { id: 3, type: 'uint64' },
  },

  DeviceDetails: {
    deviceFriendlyName: { id: 1, type: 'string' },
    platformType: { id: 2, type: 'enum' },
    osType: { id: 3, type: 'int32' },
    gamingDeviceType: { id: 4, type: 'uint32' },
  },

  BeginAuthSessionViaCredentials_Request: {
    deviceFriendlyName: { id: 1, type: 'string' },
    accountName: { id: 2, type: 'string' },
    encryptedPassword: { id: 3, type: 'string' },
    encryptionTimestamp: { id: 4, type: 'uint64' },
    rememberLogin: { id: 5, type: 'bool' },
    platformType: { id: 6, type: 'enum' },
    persistence: { id: 7, type: 'int32' },
    websiteId: { id: 8, type: 'string' },
    get deviceDetails() { return { id: 9, type: 'message', fields: MSG.DeviceDetails }; },
    guardData: { id: 10, type: 'string' },
    language: { id: 11, type: 'uint32' },
  },
  AllowedConfirmation: {
    confirmationType: { id: 1, type: 'enum' },
    associatedMessage: { id: 2, type: 'string' },
  },
  BeginAuthSessionViaCredentials_Response: {
    clientId: { id: 1, type: 'uint64' },
    requestId: { id: 2, type: 'bytes' },
    interval: { id: 3, type: 'int32' },
    get allowedConfirmations() { return { id: 4, type: 'message', repeated: true, fields: MSG.AllowedConfirmation }; },
    steamid: { id: 5, type: 'uint64' },
    weakToken: { id: 6, type: 'string' },
    extendedErrorMessage: { id: 8, type: 'string' },
  },

  PollAuthSessionStatus_Request: {
    clientId: { id: 1, type: 'uint64' },
    requestId: { id: 2, type: 'bytes' },
    tokenToRevoke: { id: 3, type: 'uint64' },
  },
  PollAuthSessionStatus_Response: {
    newClientId: { id: 1, type: 'uint64' },
    newChallengeUrl: { id: 2, type: 'string' },
    refreshToken: { id: 3, type: 'string' },
    accessToken: { id: 4, type: 'string' },
    hadRemoteInteraction: { id: 5, type: 'bool' },
    accountName: { id: 6, type: 'string' },
    newGuardData: { id: 7, type: 'string' },
  },

  UpdateAuthSessionWithSteamGuardCode_Request: {
    clientId: { id: 1, type: 'uint64' },
    steamid: { id: 2, type: 'fixed64' },
    code: { id: 3, type: 'string' },
    codeType: { id: 4, type: 'enum' },
  },

  AccountPhoneStatus_Response: { hasPhone: { id: 1, type: 'bool' } },

  AddAuthenticator_Request: {
    steamId: { id: 1, type: 'fixed64' },
    authenticatorType: { id: 4, type: 'int32' },
    deviceIdentifier: { id: 5, type: 'string' },
    smsPhoneId: { id: 6, type: 'string' },
    version: { id: 8, type: 'int32' },
  },
  AddAuthenticator_Response: {
    sharedSecret: { id: 1, type: 'bytes' },
    serialNumber: { id: 2, type: 'uint64' },
    revocationCode: { id: 3, type: 'string' },
    uri: { id: 4, type: 'string' },
    serverTime: { id: 5, type: 'int64' },
    accountName: { id: 6, type: 'string' },
    tokenGid: { id: 7, type: 'string' },
    identitySecret: { id: 8, type: 'bytes' },
    secret1: { id: 9, type: 'bytes' },
    status: { id: 10, type: 'int32' },
    phoneNumberHint: { id: 11, type: 'string' },
    confirmType: { id: 12, type: 'int32' },
  },

  SetAccountPhoneNumber_Request: {
    phoneNumber: { id: 1, type: 'string' },
    countryCode: { id: 2, type: 'string' },
  },
  SetAccountPhoneNumber_Response: {
    emailHint: { id: 1, type: 'string' },
    phoneNumber: { id: 2, type: 'string' },
  },
  IsAccountWaitingForEmailConfirmation_Response: {
    isWaiting: { id: 1, type: 'bool' },
    secondsToWait: { id: 2, type: 'int32' },
  },
  SendPhoneVerificationCode_Request: { language: { id: 1, type: 'int32' } },

  FinalizeAddAuthenticator_Request: {
    steamId: { id: 1, type: 'fixed64' },
    authenticatorCode: { id: 2, type: 'string' },
    authenticatorTime: { id: 3, type: 'uint64' },
    confirmationCode: { id: 4, type: 'string' },
    validateConfirmationCode: { id: 6, type: 'bool' },
  },
  FinalizeAddAuthenticator_Response: {
    success: { id: 1, type: 'bool' },
    wantMore: { id: 2, type: 'bool' },
    serverTime: { id: 3, type: 'uint64' },
    status: { id: 4, type: 'int32' },
  },

  RemoveAuthenticator_Request: {
    revocationCode: { id: 2, type: 'string' },
    revocationReason: { id: 5, type: 'int32' },
    steamGuardScheme: { id: 6, type: 'int32' },
  },
  RemoveAuthenticator_Response: {
    success: { id: 1, type: 'bool' },
    revocationAttemptsRemaining: { id: 5, type: 'int32' },
  },
};

export const ENDPOINTS = {
  rsaKey: `${API}/IAuthenticationService/GetPasswordRSAPublicKey/v1`,
  beginAuth: `${API}/IAuthenticationService/BeginAuthSessionViaCredentials/v1`,
  pollAuth: `${API}/IAuthenticationService/PollAuthSessionStatus/v1`,
  submitGuard: `${API}/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1`,
  phoneStatus: `${API}/IPhoneService/AccountPhoneStatus/v1`,
  setPhone: `${API}/IPhoneService/SetAccountPhoneNumber/v1`,
  emailWait: `${API}/IPhoneService/IsAccountWaitingForEmailConfirmation/v1`,
  sendSms: `${API}/IPhoneService/SendPhoneVerificationCode/v1`,
  addGuard: `${API}/ITwoFactorService/AddAuthenticator/v1`,
  finalizeGuard: `${API}/ITwoFactorService/FinalizeAddAuthenticator/v1`,
  removeGuard: `${API}/ITwoFactorService/RemoveAuthenticator/v1`,
};

const CLIENT_UA = 'okhttp/3.12.12';

export class ServiceError extends Error {
  constructor(result, msg) {
    super(msg || `Steam service error (result ${result})`);
    this.result = result;
  }
}

export async function invokeService({
  url, method = 'POST', reqShape, data, respShape, token, proxy, requireOk = true,
}) {
  const payload = reqShape && data ? packMessage(reqShape, data) : Buffer.alloc(0);
  const b64 = payload.toString('base64');

  let target = url;
  if (token) target += (target.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);

  let resp;
  if (method === 'GET') {
    target += (target.includes('?') ? '&' : '?') + 'input_protobuf_encoded=' + encodeURIComponent(b64);
    resp = await sendVia(target, { headers: { 'User-Agent': CLIENT_UA } }, proxy);
  } else {
    const form = new URLSearchParams();
    form.set('input_protobuf_encoded', b64);
    resp = await sendVia(target, {
      method: 'POST',
      headers: { 'User-Agent': CLIENT_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }, proxy);
  }

  const header = resp.headers.get('x-eresult');
  const result = header != null ? parseInt(header, 10) : null;
  const buf = Buffer.from(await resp.arrayBuffer());

  if (requireOk && result != null && result !== 1) {
    const detail = resp.headers.get('x-error_message');
    throw new ServiceError(result, detail ? `${detail} (result ${result})` : undefined);
  }
  if (!resp.ok && result == null) throw new ServiceError(null, `HTTP ${resp.status}`);

  return respShape ? { result, ...unpackMessage(respShape, buf) } : { result };
}
