/**
 * Telegram sender — minimal wrapper around the Bot API sendMessage endpoint.
 *
 * Credentials are read from env at call time (NOT at import time) so that the
 * Next.js server can pick up `.env.local` updates on reload without a fresh
 * boot.
 *
 * Per project rule #2: TOKEN / CHAT_ID never logged, never returned to the
 * client. Caller gets a boolean + a generic error string.
 *
 * Env vars expected:
 *   TELEGRAM_BOT_TOKEN   bot token from @BotFather
 *   TELEGRAM_CHAT_ID     numeric chat id (user or group)
 */

export function isTelegramConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Send a plain-text message. Returns { ok, error? }.
 * Never throws — caller can treat alerting as best-effort.
 */
export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: 'telegram_not_configured' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // Strip any token-shaped substring before surfacing.
      return { ok: false, error: `telegram_http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'telegram_network_error' };
  }
}
