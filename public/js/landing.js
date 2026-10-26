// Landing page: curriculum expand / collapse. (No fake counters, reviews or notifications.)
(function () {
  const all = document.getElementById("openAll");
  if (all) all.addEventListener("click", (e) => {
    const items = document.querySelectorAll(".lessons details");
    const open = ![...items].every((d) => d.open);
    items.forEach((d) => (d.open = open));
    all.firstChild.textContent = open ? "Hide Details " : "View Full Curriculum ";
    if (!e.target.closest("a[href]")) e.preventDefault();
  });
})();
