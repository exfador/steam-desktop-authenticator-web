import { MSG, ENDPOINTS, invokeService } from './rpc.js';
import { liveToken } from './actions.js';
import { pickProxy } from './netgate.js';

export async function revokeGuard(profile) {
  if (!profile.revocationCode) {
    throw new Error('У этого аккаунта нет revocation-кода (R-кода) — снять аутентификатор нельзя.');
  }
  if (!profile.hasSession) {
    throw new Error('Нет сессии в mafile — снятие недоступно. Переимпортируйте mafile со свежей сессией.');
  }

  const token = await liveToken(profile);
  const resp = await invokeService({
    url: ENDPOINTS.removeGuard,
    token,
    reqShape: MSG.RemoveAuthenticator_Request,
    data: { revocationCode: profile.revocationCode, revocationReason: 1, steamGuardScheme: 1 },
    respShape: MSG.RemoveAuthenticator_Response,
    proxy: pickProxy(profile.proxy),
  });

  return {
    success: !!resp.success,
    attemptsRemaining: resp.revocationAttemptsRemaining ?? null,
  };
}
