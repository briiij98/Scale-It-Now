// Shows which of the 16 lessons are connected to a YouTube video.   npm run videos:status
// Fill in data/youtube-ids.json (a full YouTube link or the 11-character ID per lesson). Exit code 1 if anything is missing/invalid.
const fs = require("fs"), path = require("path");
const { parseYouTubeId } = require("../netlify/functions/_lib/course");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "youtube-ids.json"), "utf8"));
let missing = 0, invalid = 0; const seen = new Map();
for (const e of cfg) {
  const raw = String(e.youtube || "").trim(), id = parseYouTubeId(raw);
  const state = !raw ? "MISSING" : !id ? "INVALID" : "ok";
  if (state === "MISSING") missing++; if (state === "INVALID") invalid++;
  if (id) { if (seen.has(id)) { invalid++; console.log(`  DUPLICATE: lesson ${e.lesson} uses the same video as lesson ${seen.get(id)}`); } seen.set(id, e.lesson); }
  console.log(`  ${String(e.lesson).padStart(2, "0")}  ${state.padEnd(8)} ${id || raw}  ${e.title}`);
}
console.log(`\n${cfg.length - missing - invalid}/${cfg.length} lessons connected, ${missing} missing, ${invalid} invalid/duplicate.`);
process.exit(missing || invalid ? 1 : 0);
