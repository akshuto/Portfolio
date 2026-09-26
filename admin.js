import { db, auth, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, deleteDoc, doc, setDoc, getDoc, updateDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");

// Force session-only login BEFORE checking auth state, on every page load —
// not just when the login form is submitted. This guarantees any old
// "stay logged in" session from earlier testing gets replaced by a
// session-only one the moment this page runs, instead of only switching
// over the next time someone logs in.
await setPersistence(auth, browserSessionPersistence);

// ---------- Auth gate ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.style.display = "none";
    dashboardView.style.display = "block";
    initDashboard();
  } else {
    loginView.style.display = "block";
    dashboardView.style.display = "none";
  }
});

document.querySelector("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const errorEl = document.querySelector("#login-error");
  errorEl.style.display = "none";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = "Login failed — check your email and password.";
    errorEl.style.display = "block";
  }
});

document.querySelector("#logout-btn").addEventListener("click", () => signOut(auth));

// ---------- Cloudinary upload helper ----------
// Cloudinary free plan limits: images max 10MB, videos max 100MB.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function prettySize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

async function uploadToCloudinary(file) {
  // Check the size before sending, so oversized files fail instantly with a
  // clear message instead of after a long upload.
  const isVideo = file.type.startsWith("video/");
  const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) {
    throw new Error(
      `"${file.name}" is ${prettySize(file.size)}. Cloudinary's free plan allows up to ` +
      `${isVideo ? "100MB for videos" : "10MB for images"}. Compress or shorten it and try again.`
    );
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(url, { method: "POST", body: formData });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Cloudinary explains the real reason here — surface it instead of
    // swallowing it behind a generic message.
    const reason = data && data.error && data.error.message
      ? data.error.message
      : `Upload failed (HTTP ${res.status})`;
    throw new Error(`"${file.name}": ${reason}`);
  }

  return { url: data.secure_url, resourceType: data.resource_type }; // "image" | "video"
}

// ---------- Dashboard (only runs once logged in) ----------
let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  // Top-level Portfolio / Tracker tab switcher
  document.querySelectorAll(".admin-top-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-top-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((p) => (p.style.display = "none"));
      tab.classList.add("active");
      document.querySelector("#" + tab.dataset.panel).style.display = "block";
    });
  });

  // Current avatar preview
  getDoc(doc(db, "site", "profile")).then((snap) => {
    if (snap.exists() && snap.data().avatarUrl) {
      document.querySelector("#current-avatar").src = snap.data().avatarUrl;
    }
  });

  // Change avatar
  document.querySelector("#avatar-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.querySelector("#avatar-status");
    status.textContent = "Uploading…";
    try {
      const { url } = await uploadToCloudinary(file);
      await setDoc(doc(db, "site", "profile"), { avatarUrl: url });
      document.querySelector("#current-avatar").src = url;
      status.textContent = "Profile picture updated.";
      setTimeout(() => (status.textContent = ""), 3000);
    } catch (err) {
      status.textContent = err.message || "Upload failed — please try again.";
    }
  });

  // Add project
  document.querySelector("#project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.querySelector("#project-status");
    const files = Array.from(document.querySelector("#p-file").files);
    if (!files.length) return;

    try {
      if (files.length === 1) {
        // Single image or video, same as before.
        status.textContent = "Uploading…";
        const { url, resourceType } = await uploadToCloudinary(files[0]);
        await addDoc(collection(db, "projects"), {
          title: document.querySelector("#p-title").value.trim(),
          description: document.querySelector("#p-desc").value.trim(),
          category: document.querySelector("#p-category").value,
          featured: document.querySelector("#p-featured").checked,
          wide: document.querySelector("#p-wide").checked,
          mediaType: resourceType === "video" ? "video" : "image",
          mediaUrl: url,
          order: Date.now(),
          createdAt: serverTimestamp(),
        });
      } else {
        // Multiple files selected — this becomes a "folder" (gallery).
        // Visitors see one folder card; clicking it opens all the images.
        const urls = [];
        for (let i = 0; i < files.length; i++) {
          status.textContent = `Uploading ${i + 1} of ${files.length}…`;
          const { url } = await uploadToCloudinary(files[i]);
          urls.push(url);
        }
        await addDoc(collection(db, "projects"), {
          title: document.querySelector("#p-title").value.trim(),
          description: document.querySelector("#p-desc").value.trim(),
          category: document.querySelector("#p-category").value,
          featured: document.querySelector("#p-featured").checked,
          wide: document.querySelector("#p-wide").checked,
          mediaType: "gallery",
          mediaUrl: urls[0],
          mediaUrls: urls,
          order: Date.now(),
          createdAt: serverTimestamp(),
        });
      }
      document.querySelector("#project-form").reset();
      status.textContent = "Project added.";
      setTimeout(() => (status.textContent = ""), 3000);
    } catch (err) {
      status.textContent = err.message || "Something went wrong — please try again.";
    }
  });

  // List + delete + edit projects
  const list = document.querySelector("#admin-project-list");
  const projectsCache = {}; // id -> latest doc data, used by the edit modal
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      list.innerHTML = '<p class="note">No projects yet — add your first one above.</p>';
      return;
    }
    list.innerHTML = snap.docs
      .map((d) => {
        const p = d.data();
        projectsCache[d.id] = p;
        const thumb =
          p.mediaType === "video"
            ? `<video class="admin-project-thumb" src="${p.mediaUrl}" muted></video>`
            : `<img class="admin-project-thumb" src="${p.mediaUrl}" alt="">`;
        return `
          <div class="admin-project-row">
            ${thumb}
            <div class="admin-project-info">
              <h3>${escapeHtml(p.title || "Untitled")}</h3>
              <p>${p.category === "video" ? "Video Editing" : "Graphic Design"}${p.featured ? " · Featured" : ""}${p.mediaType === "gallery" ? ` · Folder (${p.mediaUrls?.length || 0} files)` : ""}</p>
            </div>
            <button class="admin-edit-btn" data-id="${d.id}">Edit</button>
            <button class="admin-delete-btn" data-id="${d.id}">Delete</button>
          </div>
        `;
      })
      .join("");

    list.querySelectorAll(".admin-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this project? This can't be undone.")) return;
        await deleteDoc(doc(db, "projects", btn.dataset.id));
      });
    });

    list.querySelectorAll(".admin-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.id, projectsCache[btn.dataset.id]));
    });
  });

  // ---------- Edit modal ----------
  const editModal = document.querySelector("#edit-modal");
  const editFileGrid = document.querySelector("#edit-file-grid");
  let editingId = null;
  let editingFiles = []; // [{url, type}]
  let editingCover = null;

  function fileTypeFromUrl(url) {
    return url.includes("/video/upload/") ? "video" : "image";
  }

  function openEditModal(id, p) {
    editingId = id;
    editingFiles =
      p.mediaType === "gallery" && Array.isArray(p.mediaUrls)
        ? p.mediaUrls.map((url) => ({ url, type: fileTypeFromUrl(url) }))
        : p.mediaUrl
        ? [{ url: p.mediaUrl, type: p.mediaType === "video" ? "video" : "image" }]
        : [];
    editingCover = p.mediaUrl || (editingFiles[0] && editingFiles[0].url) || null;

    document.querySelector("#e-title").value = p.title || "";
    document.querySelector("#e-desc").value = p.description || "";
    document.querySelector("#e-category").value = p.category || "graphic";
    document.querySelector("#e-featured").checked = !!p.featured;
    document.querySelector("#e-wide").checked = !!p.wide;
    document.querySelector("#e-add-files").value = "";
    document.querySelector("#edit-status").textContent = "";

    renderEditGrid();
    editModal.classList.add("open");
  }

  function closeEditModal() {
    editModal.classList.remove("open");
    editingId = null;
  }

  function renderEditGrid() {
    editFileGrid.innerHTML = editingFiles
      .map((f, i) => {
        const isCover = f.url === editingCover;
        const media = f.type === "video" ? `<video src="${f.url}" muted></video>` : `<img src="${f.url}" alt="">`;
        return `
          <div class="edit-file-item${isCover ? " is-cover" : ""}" data-index="${i}">
            ${media}
            ${isCover ? '<span class="edit-file-cover-tag">Cover</span>' : ""}
            <button class="edit-file-remove" data-remove="${i}" title="Remove this file" type="button">✕</button>
          </div>
        `;
      })
      .join("");

    editFileGrid.querySelectorAll(".edit-file-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".edit-file-remove")) return;
        editingCover = editingFiles[Number(el.dataset.index)].url;
        renderEditGrid();
      });
    });

    editFileGrid.querySelectorAll(".edit-file-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.remove);
        const removedUrl = editingFiles[i].url;
        editingFiles.splice(i, 1);
        if (editingCover === removedUrl) {
          editingCover = editingFiles[0] ? editingFiles[0].url : null;
        }
        renderEditGrid();
      });
    });
  }

  document.querySelector("#edit-close").addEventListener("click", closeEditModal);
  editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });

  document.querySelector("#e-add-files").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const status = document.querySelector("#edit-status");
    try {
      for (let i = 0; i < files.length; i++) {
        status.textContent = `Uploading ${i + 1} of ${files.length}…`;
        const { url, resourceType } = await uploadToCloudinary(files[i]);
        editingFiles.push({ url, type: resourceType === "video" ? "video" : "image" });
      }
      if (!editingCover && editingFiles[0]) editingCover = editingFiles[0].url;
      status.textContent = "";
      renderEditGrid();
    } catch (err) {
      status.textContent = err.message || "Upload failed — please try again.";
    }
    e.target.value = "";
  });

  document.querySelector("#edit-save-btn").addEventListener("click", async () => {
    const status = document.querySelector("#edit-status");
    if (!editingFiles.length) {
      status.textContent = "A project needs at least one file — add one before saving.";
      return;
    }
    const updates = {
      title: document.querySelector("#e-title").value.trim(),
      description: document.querySelector("#e-desc").value.trim(),
      category: document.querySelector("#e-category").value,
      featured: document.querySelector("#e-featured").checked,
      wide: document.querySelector("#e-wide").checked,
    };

    if (editingFiles.length > 1) {
      updates.mediaType = "gallery";
      updates.mediaUrl = editingCover || editingFiles[0].url;
      updates.mediaUrls = editingFiles.map((f) => f.url);
    } else {
      updates.mediaType = editingFiles[0].type;
      updates.mediaUrl = editingFiles[0].url;
      updates.mediaUrls = [];
    }

    try {
      status.textContent = "Saving…";
      await updateDoc(doc(db, "projects", editingId), updates);
      status.textContent = "Saved.";
      setTimeout(closeEditModal, 600);
    } catch (err) {
      status.textContent = err.message || "Save failed — please try again.";
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
