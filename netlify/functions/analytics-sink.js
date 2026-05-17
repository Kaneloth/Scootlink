/**
 * analytics-sink — silently accepts and discards Base44 analytics calls.
 * Base44's SDK posts to /api/apps/{id}/analytics/track/batch; since this
 * app now runs outside Base44, those calls have no valid destination and
 * would log a 404 in the console without this handler.
 */
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ok: true }),
});
