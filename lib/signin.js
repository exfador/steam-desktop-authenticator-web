import crypto from 'node:crypto';
import { MSG, ENDPOINTS, invokeService, ServiceError } from './rpc.js';

const GUARD = { None: 1, EmailCode: 2, DeviceCode: 3, DeviceConfirmation: 4, EmailConfirmation: 5 };
const RESULT = { BadPassword: 5, BadAuthCode: 65, RateLimited: 84, TwoFactorMismatch: 88 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function trimZeros(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return buf.subarray(i);
}

function sealPassword(modHex, expHex, password) {
  const n = trimZeros(Buffer.from(modHex, 'hex'));
  const e = trimZeros(Buffer.from(expHex, 'hex'));
  const key = crypto.createPublicKey({
    key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') },
    format: 'jwk',
  });
  return crypto
    .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password, 'ascii'))
    .toString('base64');
}

export async function signInMobile(username, password, proxy, prompts) {
  const rsa = await invokeService({
    url: ENDPOINTS.rsaKey, method: 'GET',
    reqShape: MSG.GetPasswordRSAPublicKey_Request, data: { accountName: username },
    respShape: MSG.GetPasswordRSAPublicKey_Response, proxy,
  });

  const sealed = sealPassword(rsa.publicKeyMod, rsa.publicKeyExp, password);

  let begin;
  try {
    begin = await invokeService({
      url: ENDPOINTS.beginAuth,
      reqShape: MSG.BeginAuthSessionViaCredentials_Request,
      data: {
        deviceFriendlyName: 'Pixel 6 Pro',
        accountName: username,
        encryptedPassword: sealed,
        encryptionTimestamp: rsa.timestamp,
        rememberLogin: true,
        platformType: 3,
        persistence: 1,
        websiteId: 'Mobile',
        deviceDetails: { deviceFriendlyName: 'Pixel 6 Pro', platformType: 3, osType: -500, gamingDeviceType: 528 },
      },
      respShape: MSG.BeginAuthSessionViaCredentials_Response, proxy,
    });
  } catch (e) {
    if (e instanceof ServiceError && e.result === RESULT.BadPassword) {
      throw new Error('Неверный логин или пароль.');
    }
    if (e instanceof ServiceError && e.result === RESULT.RateLimited) {
      throw new Error('Слишком много попыток входа. Подождите и попробуйте позже.');
    }
    throw e;
  }

  const offered = (begin.allowedConfirmations || []).map((a) => a.confirmationType);
  if (offered.includes(GUARD.DeviceCode)) {
    throw new Error('На аккаунте уже есть мобильный аутентификатор — создать новый нельзя. Сначала удалите старый.');
  }
  if (offered.includes(GUARD.DeviceConfirmation)) {
    throw new Error('Требуется подтверждение в мобильном приложении Steam — этот способ не поддерживается.');
  }
  if (offered.includes(GUARD.EmailCode)) {
    let ok = false;
    while (!ok) {
      const code = await prompts.emailCode();
      try {
        await invokeService({
          url: ENDPOINTS.submitGuard,
          reqShape: MSG.UpdateAuthSessionWithSteamGuardCode_Request,
          data: { clientId: begin.clientId, steamid: begin.steamid, code: String(code).trim().toUpperCase(), codeType: GUARD.EmailCode },
          proxy,
        });
        ok = true;
      } catch (e) {
        if (e instanceof ServiceError && (e.result === RESULT.BadAuthCode || e.result === RESULT.TwoFactorMismatch)) {
          prompts.notify('Неверный код из письма. Попробуйте снова.');
          continue;
        }
        throw e;
      }
    }
  }

  let poll;
  for (let i = 0; i < 40; i++) {
    poll = await invokeService({
      url: ENDPOINTS.pollAuth,
      reqShape: MSG.PollAuthSessionStatus_Request,
      data: { clientId: begin.clientId, requestId: begin.requestId },
      respShape: MSG.PollAuthSessionStatus_Response, proxy,
    });
    if (poll.accessToken && poll.refreshToken) break;
    await wait(2000);
  }
  if (!poll || !poll.accessToken || !poll.refreshToken) {
    throw new Error('Не удалось получить токены входа (тайм-аут подтверждения).');
  }

  return {
    steamid: begin.steamid.toString(),
    accessToken: poll.accessToken,
    refreshToken: poll.refreshToken,
    accountName: poll.accountName || username,
  };
}
