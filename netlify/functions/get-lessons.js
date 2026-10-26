const { json, fail, AppError } = require("./_lib/http");
const { purchaseFromToken } = require("./_lib/purchase");
const { lessons } = require("./_lib/course");
const bunny = require("./_lib/bunny");

// Lesson list for verified purchasers only. Video IDs are never sent here.
exports.handler = async (event) => {
  try {
    const p = await purchaseFromToken(event);
    if (!p) throw new AppError("access_denied", 401, "This access link is invalid or no longer active.");
    return json(200, { lessons: lessons.map((l) => ({ id: l.id, title: l.title, description: l.description, durationMin: l.durationMin, hasVideo: !!(l.youtubeId || (l.videoId && bunny.isConfigured())) })) });
  } catch (e) { return fail("get-lessons", e); }
};
