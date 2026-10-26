const lessons = require("../../../data/lessons.json");
const youtubeConfig = require("../../../data/youtube-ids.json");

// Accepts a bare 11-character YouTube video ID or any normal YouTube link (watch?v=, youtu.be/, /embed/, /live/, /shorts/).
// Returns the ID, or "" if the value is empty/invalid. IDs are NEVER invented: an empty entry means "not connected yet".
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function parseYouTubeId(input) {
  const v = String(input == null ? "" : input).trim();
  if (!v) return "";
  if (YT_ID.test(v)) return v;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : "https://" + v);
    const host = u.hostname.replace(/^(www|m)\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.split("/")[1] || "";
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "watch") id = u.searchParams.get("v") || "";
      else if (["embed", "live", "shorts", "v"].includes(parts[0])) id = parts[1] || "";
    }
    return YT_ID.test(id) ? id : "";
  } catch (e) { return ""; }
}
// Attach each lesson's YouTube ID (from data/youtube-ids.json) to the lesson record.
const ytByLesson = new Map((Array.isArray(youtubeConfig) ? youtubeConfig : []).map((e) => [Number(e.lesson), e.youtube]));
for (const l of lessons) {
  const raw = ytByLesson.get(l.id);
  l.youtubeId = parseYouTubeId(raw);
  if (raw && String(raw).trim() && !l.youtubeId) console.warn(`data/youtube-ids.json: lesson ${l.id} has an invalid YouTube link/ID and was ignored`);
}
const COURSE_TITLE = "Digital Marketing Fundamentals";
// Bump this (here AND in the data-terms-version attribute on public/checkout.html AND the "Last updated" date on
// public/terms.html) whenever the Terms change. `npm run check` fails if they disagree.
const TERMS_VERSION = "2026-10-25";
const LESSON_COUNT = lessons.length; // 16
const parseLessonId = (v) => {
  if (typeof v !== "number" && !(typeof v === "string" && /^\d{1,2}$/.test(v))) return null; // rejects true, null, "", "1.5", arrays
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= LESSON_COUNT ? n : null;
};
const getLesson = (id) => lessons.find((l) => l.id === id) || null;
module.exports = { parseYouTubeId, lessons, COURSE_TITLE, TERMS_VERSION, LESSON_COUNT, parseLessonId, getLesson };
