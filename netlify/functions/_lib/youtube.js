// YouTube (Unlisted) embeds via the privacy-enhanced domain. Needs no credentials.
// NOTE: an Unlisted video is NOT access-controlled: anyone who obtains the link can watch it. We only reveal the embed URL to
// logged-in, payment-verified students, but a student could still share it. Use Bunny/Vimeo/Mux with signed URLs if you need real protection.
const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1`;
module.exports = { embedUrl };
