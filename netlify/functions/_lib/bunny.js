const crypto = require("crypto");
// Bunny Stream signed embed URL (Embed token authentication).
// token = SHA256_HEX(TOKEN_SECURITY_KEY + videoId + expiresUnixSeconds)
// Needs BUNNY_LIBRARY_ID and BUNNY_TOKEN_KEY in Netlify environment variables.
function isConfigured() {
  return !!(process.env.BUNNY_LIBRARY_ID && process.env.BUNNY_TOKEN_KEY);
}
function signedEmbedUrl(videoId, ttlSeconds = 4 * 3600) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = crypto.createHash("sha256").update(process.env.BUNNY_TOKEN_KEY + videoId + expires).digest("hex");
  const lib = encodeURIComponent(process.env.BUNNY_LIBRARY_ID);
  return `https://iframe.mediadelivery.net/embed/${lib}/${encodeURIComponent(videoId)}?token=${token}&expires=${expires}&autoplay=false&preload=true`;
}
module.exports = { isConfigured, signedEmbedUrl };
