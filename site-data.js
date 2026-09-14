import { db } from "./firebase-init.js";
import {
  collection, query, orderBy, onSnapshot, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Keeps every project doc we've seen (from whichever grid(s) are on this
// page) so the lightbox can find full details when a card is clicked.
const projectsById = {};

// ---------- Profile picture (used on every page that has [data-avatar]) ----------
const avatarEls = document.querySelectorAll("[data-avatar]");
if (avatarEls.length) {
  onSnapshot(doc(db, "site", "profile"), (snap) => {
    const url = snap.exists() ? snap.data().avatarUrl : null;
    if (url) avatarEls.forEach((img) => (img.src = url));
  });
}

// ---------- Helpers ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Normalizes a project doc's media into an array of {url, type}, matching
// what admin.js actually writes: a single {mediaType, mediaUrl}, or a
// gallery {mediaType:"gallery", mediaUrl (cover), mediaUrls: [url, ...]}.
function mediaListFor(p) {
  if (p.mediaType === "gallery" && Array.isArray(p.mediaUrls) && p.mediaUrls.length) {
    return p.mediaUrls.map((url) => ({
      url,
      // Cloudinary encodes resource type in the URL path itself.
      type: url.includes("/video/upload/") ? "video" : "image",
    }));
  }
  if (p.mediaUrl) return [{ url: p.mediaUrl, type: p.mediaType === "video" ? "video" : "image" }];
  return [];
}

function cardHTML(id, p) {
  const media = mediaListFor(p);
  const cover = media[0];
  const wideClass = p.wide ? " wide" : "";
  const tagClass = p.category === "video" ? "video" : "graphic";
  const tagLabel = p.category === "video" ? "Video Editing" : "Graphic Design";

  const coverHTML = !cover
    ? `<div class="card-media empty"><div class="plus">+</div><span>No files yet</span></div>`
    : `<div class="card-media">
         ${cover.type === "video" ? `<video src="${cover.url}" muted></video>` : `<img src="${cover.url}" alt="${escapeHtml(p.title || "Project image")}">`}
         ${media.length > 1 ? `<span class="folder-badge">📁 ${media.length} files</span>` : ""}
       </div>`;

  return `
    <article class="card${wideClass}" data-category="${tagClass}" data-id="${id}">
      ${coverHTML}
      <div class="card-body">
        <span class="tag ${tagClass}">${tagLabel}</span>
        <h3 class="card-title">${escapeHtml(p.title || "Untitled project")}</h3>
        <p class="card-desc">${escapeHtml(p.description || "")}</p>
      </div>
    </article>
  `;
}

function emptyStateHTML(message) {
  return `<p class="note" style="grid-column: 1 / -1;">${message}</p>`;
}

// ---------- Featured grid (index.html) ----------
const featuredGrid = document.querySelector("#featured-work-grid");
if (featuredGrid) {
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => {
      projectsById[d.id] = d.data();
      if (d.data().featured) items.push([d.id, d.data()]);
    });
    featuredGrid.innerHTML = items.length
      ? items.slice(0, 4).map(([id, p]) => cardHTML(id, p)).join("")
      : emptyStateHTML("No featured projects yet — add some from the admin page.");
  });
}

// ---------- Full grid (projects.html) with filters ----------
const allGrid = document.querySelector("#all-work-grid");
if (allGrid) {
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => {
      projectsById[d.id] = d.data();
      items.push([d.id, d.data()]);
    });
    allGrid.innerHTML = items.length
      ? items.map(([id, p]) => cardHTML(id, p)).join("")
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

// ---------- Project viewer (lightbox) ----------
const lightbox = document.querySelector("#lightbox");
if (lightbox) {
  const closeBtn = document.querySelector("#lightbox-close");
  const grid = document.querySelector("#lightbox-grid");
  const titleEl = document.querySelector("#lightbox-title");
  const descEl = document.querySelector("#lightbox-desc");
  const tagEl = document.querySelector("#lightbox-tag");

  function openProject(id) {
    const p = projectsById[id];
    if (!p) return;
    const media = mediaListFor(p);
    titleEl.textContent = p.title || "Untitled project";
    descEl.textContent = p.description || "";
    tagEl.textContent = p.category === "video" ? "Video Editing" : "Graphic Design";
    tagEl.className = "tag " + (p.category === "video" ? "video" : "graphic");
    grid.innerHTML = media
      .map((m) =>
        m.type === "video"
          ? `<video src="${m.url}" controls></video>`
          : `<img src="${m.url}" alt="">`
      )
      .join("");
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
  }

  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card) openProject(card.dataset.id);
  });

  closeBtn.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}
