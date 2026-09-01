// Discord/Slack webhook delivery.
//
// THE ALARM MUST NEVER BE THE THING THAT RAISES THE ALARM.
//
// This is the doctrine deploy-content.yml's `notify` job already learned the
// hard way: on 2026-08-17 GitHub 503s made the notifier paint green deploys red
// and hold a false incident issue open, which is why that step carries
// `continue-on-error`. Same rule here, one layer down — every function in this
// file swallows its own failure, prints why, and returns false. A monitor that
// exits non-zero because Discord was briefly down teaches you to ignore it, and
// an ignored monitor is worse than none.
//
// The full report is ALWAYS printed to stdout before this is called, so a failed
// post loses the notification, never the information.

const TIMEOUT_MS = 10_000;

/** Discord caps a message at 2000 chars. Trim the body, never the verdict. */
const DISCORD_LIMIT = 1900;

function isSlack(url) {
  return /hooks\.slack\.com/.test(url);
}

/**
 * Post a plain-text report to a Discord or Slack incoming webhook.
 * @returns {Promise<boolean>} true if delivered; false on any failure.
 */
export async function postWebhook(url, text, { username = 'Free-Tier Watch' } = {}) {
  if (!url) {
    console.log('· No OPS_WEBHOOK_URL set — report printed above, nothing sent.');
    return false;
  }

  let body = text;
  if (body.length > DISCORD_LIMIT) {
    body = `${body.slice(0, DISCORD_LIMIT - 40)}\n… (truncated — run npm run ops:usage)`;
  }

  const payload = isSlack(url)
    ? { text: body }
    : { username, content: body, allowed_mentions: { parse: [] } };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.warn(`⚠ Webhook POST failed: HTTP ${res.status} ${detail}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`⚠ Webhook POST failed: ${e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : e.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
