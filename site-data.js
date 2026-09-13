import { db } from "./firebase-init.js";
import {
  collection, query, orderBy, onSnapshot, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Profile picture (used on every page that has [data-avatar]) ----------
const avatarEls = document.querySelectorAll("[data-avatar]");
if (avatarEls.length) {
  onSnapshot(doc(db, "site", "profile"), (snap) => {
    const url = snap.exists() ? snap.data().avatarUrl : null;
    if (url) avatarEls.forEach((img) => (img.src = url));
  });
}

// ---------- Project cards ----------
function cardHTML(p) {
  const wideClass = p.wide ? " wide" : "";
  const tagClass = p.category === "video" ? "video" : "graphic";
  const tagLabel = p.category === "video" ? "Video Editing" : "Graphic Design";
  const media =
    p.mediaType === "video" && p.mediaUrl
      ? `<video src="${p.mediaUrl}" controls></video>`
      : p.mediaUrl
      ? `<img src="${p.mediaUrl}" alt="${escapeHtml(p.title || "Project image")}">`
      : `<div class="card-media empty"><div class="plus">+</div><span>No image yet</span></div>`;

  const mediaWrap = p.mediaUrl ? `<div class="card-media">${media}</div>` : media;

  return `
    <article class="card${wideClass}" data-category="${tagClass}">
      ${mediaWrap}
      <div class="card-body">
        <span class="tag ${tagClass}">${tagLabel}</span>
        <h3 class="card-title">${escapeHtml(p.title || "Untitled project")}</h3>
        <p class="card-desc">${escapeHtml(p.description || "")}</p>
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function emptyStateHTML(message) {
  return `<p class="note" style="grid-column: 1 / -1;">${message}</p>`;
}

// Featured grid on the home page (index.html) — shows everything marked "featured", newest first.
const featuredGrid = document.querySelector("#featured-work-grid");
if (featuredGrid) {
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => d.data()).filter((p) => p.featured);
    featuredGrid.innerHTML = items.length
      ? items.slice(0, 4).map(cardHTML).join("")
      : emptyStateHTML("No featured projects yet — add some from the admin page.");
  });
}

// Full grid on the work page (projects.html) — everything, with working filters.
const allGrid = document.querySelector("#all-work-grid");
if (allGrid) {
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => d.data());
    allGrid.innerHTML = items.length
      ? items.map(cardHTML).join("")
      : emptyStateHTML("No projects yet — add some from the admin page.");
    applyActiveFilter();
  });

  const filterButtons = document.querySelectorAll(".filter-btn");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      applyActiveFilter();
    });
  });

  function applyActiveFilter() {
    const active = document.querySelector('.filter-btn[aria-pressed="true"]');
    const category = active ? active.dataset.filter : "all";
    document.querySelectorAll("#all-work-grid [data-category]").forEach((card) => {
      const match = category === "all" || card.dataset.category === category;
      card.style.display = match ? "" : "none";
    });
  }
}
