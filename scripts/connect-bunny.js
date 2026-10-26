#!/usr/bin/env node
// Connects your uploaded Bunny Stream videos to the 16 lessons by writing data/lessons.json.
//
//   BUNNY_LIBRARY_ID=123456 BUNNY_API_KEY=xxxx node scripts/connect-bunny.js           # preview only
//   BUNNY_LIBRARY_ID=123456 BUNNY_API_KEY=xxxx node scripts/connect-bunny.js --write   # save to data/lessons.json
//   node scripts/connect-bunny.js --status                                              # which lessons have a video?
//
// BUNNY_API_KEY = the library's "API Key" (Bunny dashboard > Stream > your library > API). It is used only on
// your own computer for this command. It is NOT the embed token key, and it must never go into Netlify or GitHub.
//
// Matching rule: name each video in Bunny starting with its lesson number, e.g. "01 Introduction...",
// "02 - Optimizing...", "Lesson 3 ...". Exactly one video per lesson 1-16 is required before anything is written.
const fs = require("fs");
const FILE = "data/lessons.json";

// Pure function (unit-tested in test/run.js): videos = [{guid, title, length, status}]
function matchVideos(videos, lessonCount = 16) {
  const found = {}, problems = [];
  for (const v of videos) {
    const m = String(v.title || "").trim().match(/^(?:lesson\s*)?0*(\d{1,2})\b/i);
    if (!m) { problems.push(`Ignored "${v.title}" (title does not start with a lesson number)`); continue; }
    const n = Number(m[1]);
    if (n < 1 || n > lessonCount) { problems.push(`Ignored "${v.title}" (lesson ${n} is outside 1-${lessonCount})`); continue; }
    (found[n] = found[n] || []).push(v);
  }
  const map = {};
  for (let n = 1; n <= lessonCount; n++) {
    const list = found[n] || [];
    if (list.length === 0) problems.push(`Lesson ${n}: no video found`);
    else if (list.length > 1) problems.push(`Lesson ${n}: ${list.length} videos match (${list.map((x) => x.title).join(" | ")}). Rename so only one starts with ${n}`);
    else {
      map[n] = { videoId: list[0].guid, durationMin: list[0].length ? Math.max(1, Math.round(list[0].length / 60)) : null };
      if (list[0].status !== undefined && list[0].status !== 4) problems.push(`Lesson ${n}: video is still processing or failed (status ${list[0].status}); wait until Bunny shows it as finished`);
    }
  }
  return { map, problems, complete: Object.keys(map).length === lessonCount && !problems.some((p) => /^Lesson/.test(p)) };
}

async function listVideos(lib, key, fetchFn = fetch) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetchFn(`https://video.bunnycdn.com/library/${encodeURIComponent(lib)}/videos?page=${page}&itemsPerPage=100`, { headers: { AccessKey: key, accept: "application/json" } });
    if (!r.ok) throw new Error(`Bunny API answered ${r.status}. Check BUNNY_LIBRARY_ID and BUNNY_API_KEY.`);
    const d = await r.json(); out.push(...(d.items || []));
    if (out.length >= (d.totalItems || 0) || !(d.items || []).length) break;
  }
  return out;
}

async function main() {
  const lessons = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (process.argv.includes("--status")) {
    lessons.forEach((l) => console.log(String(l.id).padStart(2), l.videoId ? "connected  " + l.videoId : "NO VIDEO   ", "-", l.title));
    const n = lessons.filter((l) => l.videoId).length; console.log(`\n${n} of ${lessons.length} lessons have a video ID.`); return;
  }
  const { BUNNY_LIBRARY_ID: lib, BUNNY_API_KEY: key } = process.env;
  if (!lib || !key) { console.error("Set BUNNY_LIBRARY_ID and BUNNY_API_KEY (see the comment at the top of this file)."); process.exit(1); }
  const res = matchVideos(await listVideos(lib, key), lessons.length);
  res.problems.forEach((p) => console.log("!", p));
  lessons.forEach((l) => console.log(String(l.id).padStart(2), res.map[l.id] ? res.map[l.id].videoId + "  " + (res.map[l.id].durationMin || "?") + " min" : "-"));
  if (!res.complete) { console.error("\nNot written: fix the items marked ! above and run again."); process.exit(1); }
  if (!process.argv.includes("--write")) { console.log("\nPreview only. Run again with --write to save to " + FILE); return; }
  lessons.forEach((l) => { l.videoId = res.map[l.id].videoId; l.durationMin = res.map[l.id].durationMin; });
  fs.writeFileSync(FILE, JSON.stringify(lessons, null, 2) + "\n");
  console.log("\nSaved " + FILE + ". Commit and push it, then Netlify redeploys with your videos connected.");
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { matchVideos, listVideos };
