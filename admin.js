import { db, auth, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, deleteDoc, doc, setDoc, getDoc,
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
async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return { url: data.secure_url, resourceType: data.resource_type }; // resourceType: "image" | "video"
}

// ---------- Dashboard (only runs once logged in) ----------
let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

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
      status.textContent = "Upload failed — please try again.";
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
      status.textContent = "Something went wrong — please try again.";
    }
  });

  // List + delete projects
  const list = document.querySelector("#admin-project-list");
  const q = query(collection(db, "projects"), orderBy("order", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      list.innerHTML = '<p class="note">No projects yet — add your first one above.</p>';
      return;
    }
    list.innerHTML = snap.docs
      .map((d) => {
        const p = d.data();
        const thumb =
          p.mediaType === "video"
            ? `<video class="admin-project-thumb" src="${p.mediaUrl}" muted></video>`
            : `<img class="admin-project-thumb" src="${p.mediaUrl}" alt="">`;
        return `
          <div class="admin-project-row">
            ${thumb}
            <div class="admin-project-info">
              <h3>${escapeHtml(p.title || "Untitled")}</h3>
              <p>${p.category === "video" ? "Video Editing" : "Graphic Design"}${p.featured ? " · Featured" : ""}${p.mediaType === "gallery" ? ` · Folder (${p.mediaUrls?.length || 0} images)` : ""}</p>
            </div>
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
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
