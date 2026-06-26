import crypto from 'node:crypto';
import { MSG, ENDPOINTS, invokeService } from './rpc.js';
import { buildCode } from './guardcode.js';
import { serverClock } from './clock.js';

const RESULT = { OK: 1, Pending: 22 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeDeviceId() {
  return 'android:' + crypto.randomUUID();
}

function asPhone(input) {
  return '+' + String(input).replace(/[^\d]/g, '');
}

async function waitEmailLink(token, proxy) {
  for (let i = 0; i < 5; i++) {
    const resp = await invokeService({
      url: ENDPOINTS.emailWait, token,
      respShape: MSG.IsAccountWaitingForEmailConfirmation_Response, proxy,
    });
    if (!resp.isWaiting) return true;
    await wait(Math.max(1, resp.secondsToWait || 2) * 1000);
  }
  return false;
}

async function finalize(token, steam64, secretB64, confirmationCode, validateSms, proxy) {
  for (let tries = 0; tries < 30; tries++) {
    const time = await serverClock();
    const code = buildCode(secretB64, time);
    const resp = await invokeService({
      url: ENDPOINTS.finalizeGuard, token,
      reqShape: MSG.FinalizeAddAuthenticator_Request,
      data: {
        steamId: BigInt(steam64),
        authenticatorCode: code,
        authenticatorTime: BigInt(time),
        confirmationCode,
        validateConfirmationCode: validateSms,
      },
      respShape: MSG.FinalizeAddAuthenticator_Response, proxy, requireOk: false,
    });

    if (resp.success && !resp.wantMore) return { success: true };
    if (resp.status === 89) return { success: false, error: 'Неверный код подтверждения.' };
    if (resp.status === 88 && tries >= 29) {
      return { success: false, error: 'Не удалось подобрать корректные коды — проверьте системное время.' };
    }
  }
  return { success: false, error: 'Не удалось завершить привязку.' };
}

export async function enrollDevice(login, proxy, prompts) {
  const token = login.accessToken;
  const steam64 = login.steamid;
  const deviceId = makeDeviceId();

  const phone = await invokeService({
    url: ENDPOINTS.phoneStatus, token, respShape: MSG.AccountPhoneStatus_Response, proxy,
  });
  const hasPhone = !!phone.hasPhone;

  let phoneNumber = null;
  if (!hasPhone) {
    const entered = await prompts.phoneNumber();
    phoneNumber = entered && String(entered).replace(/[^\d]/g, '') ? entered : null;
  }

  if (!hasPhone && phoneNumber) {
    const attach = await invokeService({
      url: ENDPOINTS.setPhone, token,
      reqShape: MSG.SetAccountPhoneNumber_Request, data: { phoneNumber: asPhone(phoneNumber) },
      respShape: MSG.SetAccountPhoneNumber_Response, proxy, requireOk: false,
    });
    if (attach.result !== RESULT.Pending && attach.result !== RESULT.OK) {
      throw new Error('Не удалось привязать номер телефона (код ' + attach.result + '). Проверьте номер.');
    }

    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
      await prompts.confirmEmailLink();
      confirmed = await waitEmailLink(token, proxy);
    }
    if (!confirmed) throw new Error('Не удалось подтвердить привязку телефона по ссылке из письма.');

    const sms = await invokeService({
      url: ENDPOINTS.sendSms, token,
      reqShape: MSG.SendPhoneVerificationCode_Request, data: { language: 0 },
      proxy, requireOk: false,
    });
    if (sms.result !== RESULT.OK) throw new Error('Не удалось отправить SMS-код (код ' + sms.result + ').');
  }

  const add = await invokeService({
    url: ENDPOINTS.addGuard, token,
    reqShape: MSG.AddAuthenticator_Request,
    data: { steamId: BigInt(steam64), authenticatorType: 1, deviceIdentifier: deviceId, version: 2 },
    respShape: MSG.AddAuthenticator_Response, proxy,
  });

  if (add.status === 29) throw new Error('К аккаунту уже привязан аутентификатор.');
  if (add.status !== 1) throw new Error('AddAuthenticator вернул статус ' + add.status + '.');

  const sharedSecret = Buffer.from(add.sharedSecret).toString('base64');
  const identitySecret = Buffer.from(add.identitySecret).toString('base64');

  const isPhone = add.confirmType === 1 || add.confirmType === 2;
  let confirmationCode;
  if (isPhone) confirmationCode = String(await prompts.smsCode(add.phoneNumberHint)).trim();
  else if (add.confirmType === 3) confirmationCode = String(await prompts.emailAuthCode()).trim();
  else throw new Error('Тип подтверждения ' + add.confirmType + ' не поддерживается.');

  const done = await finalize(token, steam64, sharedSecret, confirmationCode, isPhone, proxy);
  if (!done.success) throw new Error(done.error);

  const sessionId = crypto.randomBytes(12).toString('hex');
  const vault = {
    shared_secret: sharedSecret,
    identity_secret: identitySecret,
    device_id: deviceId,
    account_name: add.accountName || login.accountName,
    revocation_code: add.revocationCode,
    serial_number: add.serialNumber?.toString?.() ?? '',
    uri: add.uri || '',
    token_gid: add.tokenGid || '',
    server_time: add.serverTime?.toString?.() ?? '',
    Session: {
      SteamID: steam64,
      RefreshToken: login.refreshToken,
      AccessToken: login.accessToken,
      SessionID: sessionId,
    },
  };

  return {
    mafile: vault,
    revocationCode: add.revocationCode,
    steam64,
    accountName: vault.account_name,
  };
}
