const { json, fail, AppError } = require("./_lib/http");
const { purchaseFromToken } = require("./_lib/purchase");
const { parseLessonId, getLesson } = require("./_lib/course");
const bunny = require("./_lib/bunny");
const youtube = require("./_lib/youtube");

// Player URL for ONE lesson, only for a verified purchaser. Order of preference:
//   1) YouTube (data/youtube-ids.json)   2) Bunny Stream signed URL (optional)
exports.handler = async (event) => {
  try {
    const p = await purchaseFromToken(event);
    if (!p) throw new AppError("access_denied", 401, "This access link is invalid or no longer active.");
    const id = parseLessonId((event.queryStringParameters || {}).lesson);
    if (!id) throw new AppError("bad_lesson", 400, "Invalid lesson.");
    const lesson = getLesson(id);
    if (lesson.youtubeId) return json(200, { status: "ok", provider: "youtube", url: youtube.embedUrl(lesson.youtubeId) });
    if (!lesson.videoId) return json(200, { status: "no_video", message: "This lesson's video is not available yet. Please check back soon." });
    if (!bunny.isConfigured()) return json(200, { status: "not_configured", message: "Video hosting is not set up yet. Please check back soon." });
    return json(200, { status: "ok", provider: "bunny", url: bunny.signedEmbedUrl(lesson.videoId) });
  } catch (e) { return fail("get-video-url", e); }
};
