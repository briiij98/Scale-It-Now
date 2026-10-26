// Lesson player for verified purchasers: list, video, previous/next, resume (last lesson is remembered in this browser only).
(async function () {
  const $ = (id) => document.getElementById(id), A = window.SIN_ACCESS;
  const say = (t) => { $("msg").textContent = t; $("msg").classList.remove("hidden"); };
  A.fromHash();
  const r = await A.api("get-lessons");
  if (!r) return say("Could not reach the server. Check your internet connection and refresh.");
  if (r.status === 401) { $("locked").classList.remove("hidden"); $("msg").remove(); return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return say(d.error || "Could not load the lessons.");
  $("msg").remove(); $("player").classList.remove("hidden");

  const lessons = d.lessons;
  const qid = Number(new URLSearchParams(location.search).get("lesson"));
  let saved = 0; try { saved = Number(localStorage.getItem("sin_last_lesson")) || 0; } catch (e) {}
  let current = lessons.some((l) => l.id === qid) ? qid : (lessons.some((l) => l.id === saved) ? saved : lessons[0].id);

  const list = $("lessonList");
  const renderList = () => {
    list.replaceChildren();
    lessons.forEach((l) => {
      const li = document.createElement("li"), a = document.createElement("button");
      a.type = "button"; a.className = "lrow" + (l.id === current ? " active" : "");
      if (l.id === current) a.setAttribute("aria-current", "true");
      const n = document.createElement("span"); n.className = "n"; n.textContent = String(l.id).padStart(2, "0");
      const t = document.createElement("span"); t.textContent = l.title;
      a.append(n, t); a.onclick = () => open(l.id); li.appendChild(a); list.appendChild(li);
    });
    $("pText").textContent = lessons.length + " lessons";
  };

  const frameBox = $("frameBox"), note = $("videoNote");
  async function open(id) {
    current = id; const l = lessons.find((x) => x.id === id);
    $("lTitle").textContent = "Lesson " + id + ": " + l.title; $("lDesc").textContent = l.description;
    $("prev").disabled = id === 1; $("next").disabled = id === lessons.length;
    try { localStorage.setItem("sin_last_lesson", String(id)); } catch (e) {}
    history.replaceState(null, "", "lesson.html?lesson=" + id);
    renderList();
    frameBox.replaceChildren(); note.textContent = "Loading video…"; note.classList.remove("hidden");
    const v = await A.api("get-video-url?lesson=" + id);
    if (current !== id) return; // user clicked another lesson meanwhile
    const b = v ? await v.json().catch(() => ({})) : {};
    if (v && v.status === 401) { location.href = "access.html"; return; }
    if (v && v.ok && b.status === "ok") {
      const f = document.createElement("iframe");
      f.src = b.url; f.title = l.title; f.allowFullscreen = true; f.loading = "lazy"; f.referrerPolicy = "strict-origin-when-cross-origin";
      f.allow = "accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen";
      frameBox.appendChild(f); note.classList.add("hidden");
    } else note.textContent = (b && b.message) || (v ? (b.error || "Could not load the video.") : "Could not reach the server. Check your connection and try again.");
  }
  $("prev").onclick = () => open(current - 1);
  $("next").onclick = () => open(current + 1);
  open(current);
})();
