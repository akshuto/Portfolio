import {
  db, auth,
  TRACKER_PROJECTS_COLLECTION, TRACKER_INVOICES_COLLECTION, TRACKER_SETTINGS_DOC
} from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let tkProjects = [];
let tkSettings = { companyName: "", logo: "", nextInvoice: "INV-001", banks: [] };
let tkInvoices = [];
let tkInitialized = false;
let tkLastPayment = null;

// Extra Firestore locations used by the "last payment" + public stats feature.
const TRACKER_LASTPAY_DOC = ["tracker_meta", "lastPayment"];
const TRACKER_PUBLIC_DOC = ["tracker_public", "summary"];

function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

function fmt(n) {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN");
}
function esc(s) {
  const div = document.createElement("div");
  div.textContent = s || "";
  return div.innerHTML;
}

// Only wire everything up once the person is actually logged in — this
// panel lives inside admin.html, behind the same Firebase login.
onAuthStateChanged(auth, (user) => {
  if (user && !tkInitialized) {
    tkInitialized = true;
    initTracker();
  }
});

function initTracker() {
  // ---------- Sub-tab switching ----------
  document.querySelectorAll(".tk-subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tk-subtab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tk-section").forEach((s) => (s.style.display = "none"));
      tab.classList.add("active");
      document.querySelector("#" + tab.dataset.tksection).style.display = "block";
    });
  });

  // ---------- Public stats summary ----------
  // Writes a small, read-only copy of your totals to tracker_public/summary
  // so stats.html can show it to visitors. Client names and bank details
  // are never included.
  const loaded = { projects: false, lastPayment: false };
  let publishTimer = null;
  let lastPublishedSig = "";

  function schedulePublish() {
    if (!loaded.projects || !loaded.lastPayment) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publishPublicSummary, 1500);
  }

  async function publishPublicSummary() {
    const billed = tkProjects.reduce((a, p) => a + Number(p.amount || 0), 0);
    const received = tkProjects.reduce((a, p) => a + Number(p.received || 0), 0);
    const statusCounts = { pending: 0, process: 0, cleared: 0 };
    tkProjects.forEach((p) => { if (p.status in statusCounts) statusCounts[p.status]++; });
    const summary = {
      totals: { billed, received, pending: billed - received },
      statusCounts,
      lastPayment: tkLastPayment
        ? { amount: Number(tkLastPayment.amount || 0), date: tkLastPayment.date || "" }
        : null,
      projects: [...tkProjects]
        .sort((a, b) => (a.serial || 0) - (b.serial || 0))
        .map((p) => ({
          title: p.title || "",
          type: p.type || "",
          date: p.date || "",
          status: p.status || "pending",
          amount: Number(p.amount || 0),
          pending: Math.max(0, Number(p.amount || 0) - Number(p.received || 0)),
        })),
    };
    const sig = JSON.stringify(summary);
    if (sig === lastPublishedSig) return;
    try {
      await setDoc(doc(db, ...TRACKER_PUBLIC_DOC), { ...summary, updatedAt: new Date().toISOString() });
      lastPublishedSig = sig;
    } catch (err) {
      console.warn("Could not update the public stats page:", err);
    }
  }

  async function recordLastPayment(amount) {
    await setDoc(doc(db, ...TRACKER_LASTPAY_DOC), {
      amount: Number(amount),
      date: todayLocal(),
      updatedAt: serverTimestamp(),
    });
  }

  // ---------- Live data ----------
  onSnapshot(collection(db, TRACKER_PROJECTS_COLLECTION), (snap) => {
    tkProjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loaded.projects = true;
    renderAll();
    schedulePublish();
  });

  onSnapshot(doc(db, ...TRACKER_LASTPAY_DOC), (snap) => {
    tkLastPayment = snap.exists() ? snap.data() : null;
    loaded.lastPayment = true;
    document.querySelector("#tk_lp_amount").value = tkLastPayment ? tkLastPayment.amount ?? "" : "";
    document.querySelector("#tk_lp_date").value = tkLastPayment ? tkLastPayment.date || "" : "";
    renderDashboard();
    schedulePublish();
  });

  onSnapshot(doc(db, ...TRACKER_SETTINGS_DOC), (snap) => {
    if (snap.exists()) {
      tkSettings = { banks: [], ...snap.data() };
      loadSettingsToForm();
      renderAll();
    }
  });

  onSnapshot(collection(db, TRACKER_INVOICES_COLLECTION), (snap) => {
    tkInvoices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderInvoices();
  });

  // ---------- Status filter tabs (Projects section) ----------
  let activeFilter = "all";
  document.querySelector("#tkStatusTabs").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll("#tkStatusTabs button").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    activeFilter = e.target.dataset.f;
    renderProjects(activeFilter);
  });

  function renderAll() {
    renderDashboard();
    renderProjects(activeFilter);
    renderInvoices();
    renderPayList();
  }

  function statusBadge(s) {
    const map = { pending: "Pending", process: "In process", cleared: "Cleared" };
    return `<span class="tk-status ${s}">${map[s] || s}</span>`;
  }

  function projectsTable(list, withActions) {
    if (!list.length) return `<p class="note">No projects yet — add your first one above.</p>`;
    const rows = list
      .map((p) => {
        const unit = p.type === "video" ? (p.duration ? esc(p.duration) : "—") : p.slides ? p.slides + " slides" : "—";
        const pending = Math.max(0, Number(p.amount || 0) - Number(p.received || 0));
        return `<tr>
          <td>${p.serial}</td>
          <td>${esc(p.title)}<div style="color: var(--muted); font-size: 12px;">${esc(p.client || "")}</div></td>
          <td>${p.date || "—"}</td>
          <td>${unit}</td>
          <td>${fmt(p.amount)}</td>
          <td>${fmt(pending)}</td>
          <td>${statusBadge(p.status)}</td>
          ${withActions ? `<td><div class="tk-row-actions">
            <button class="tk-icon-btn" data-tk-edit="${p.id}" title="Edit">✎</button>
            <button class="tk-icon-btn" data-tk-delete="${p.id}" title="Delete">✕</button>
          </div></td>` : ""}
        </tr>`;
      })
      .join("");
    return `<table class="tk-table"><thead><tr><th>#</th><th>Project</th><th>Date</th><th>Duration/Slides</th><th>Amount</th><th>Pending</th><th>Status</th>${withActions ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function wireRowActions(container) {
    container.querySelectorAll("[data-tk-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openProjectModal(btn.dataset.tkEdit));
    });
    container.querySelectorAll("[data-tk-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this project?")) return;
        await deleteDoc(doc(db, TRACKER_PROJECTS_COLLECTION, btn.dataset.tkDelete));
      });
    });
  }

  function renderDashboard() {
    const total = tkProjects.reduce((a, p) => a + Number(p.amount || 0), 0);
    const received = tkProjects.reduce((a, p) => a + Number(p.received || 0), 0);
    const pending = total - received;
    const inProcess = tkProjects.filter((p) => p.status === "process").length;
    document.querySelector("#tkStatCards").innerHTML = `
      <div class="tk-card"><div class="tk-label">Total billed</div><div class="tk-num">${fmt(total)}</div></div>
      <div class="tk-card ok"><div class="tk-label">Cleared</div><div class="tk-num">${fmt(received)}</div></div>
      <div class="tk-card wait"><div class="tk-label">Pending</div><div class="tk-num">${fmt(pending)}</div></div>
      <div class="tk-card"><div class="tk-label">Projects in process</div><div class="tk-num">${inProcess}</div></div>
      <div class="tk-card"><div class="tk-label">Last payment</div><div class="tk-num">${tkLastPayment ? fmt(tkLastPayment.amount) : "—"}</div>${tkLastPayment && tkLastPayment.date ? `<div class="tk-label" style="margin: 6px 0 0;">${esc(tkLastPayment.date)}</div>` : ""}${tkLastPayment && (tkLastPayment.projects || []).length ? `<div class="tk-label" style="margin: 4px 0 0;">${esc(tkLastPayment.projects.join(", "))}</div>` : ""}</div>`;
    const recent = [...tkProjects].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
    const wrap = document.querySelector("#tkRecentTableWrap");
    wrap.innerHTML = projectsTable(recent, false);
  }

  function renderProjects(filter) {
    let list = [...tkProjects].sort((a, b) => a.serial - b.serial);
    if (filter && filter !== "all") list = list.filter((p) => p.status === filter);
    const wrap = document.querySelector("#tkProjectsTableWrap");
    wrap.innerHTML = projectsTable(list, true);
    wireRowActions(wrap);
  }

  function renderInvoices() {
    const wrap = document.querySelector("#tkInvoicesTableWrap");
    if (!tkInvoices.length) {
      wrap.innerHTML = `<p class="note">No invoices generated yet — generate one from the Invoices tab.</p>`;
      return;
    }
    const rows = [...tkInvoices]
      .reverse()
      .map(
        (iv) => `<tr>
          <td>${esc(iv.number)}</td><td>${esc(iv.client)}</td><td>${iv.date}</td>
          <td>${(iv.items || []).map((i) => esc(i.title)).join(", ")}</td><td>${fmt(iv.total)}</td>
        </tr>`
      )
      .join("");
    wrap.innerHTML = `<table class="tk-table"><thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Items</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- Project modal ----------
  const projectModal = document.querySelector("#tk-project-modal");

  function toggleTypeFields() {
    const isVideo = document.querySelector("#tk_p_type").value === "video";
    document.querySelector("#tk_p_durationWrap").style.display = isVideo ? "block" : "none";
    document.querySelector("#tk_p_slidesWrap").style.display = isVideo ? "none" : "block";
  }

  function updatePendingPreview() {
    const amt = Number(document.querySelector("#tk_p_amount").value || 0);
    const rec = Number(document.querySelector("#tk_p_received").value || 0);
    document.querySelector("#tk-pending-preview").textContent = "Pending: " + fmt(Math.max(0, amt - rec));
  }

  function fillBankSelect() {
    const sel = document.querySelector("#tk_p_bank");
    sel.innerHTML = '<option value="">— none —</option>' + (tkSettings.banks || []).map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join("");
  }

  function openProjectModal(id) {
    fillBankSelect();
    const p = id ? tkProjects.find((x) => x.id === id) : null;
    document.querySelector("#tk-project-modal-title").textContent = id ? "Edit project" : "New project";
    document.querySelector("#tk_p_id").value = id || "";
    document.querySelector("#tk_p_client").value = p ? p.client || "" : "";
    document.querySelector("#tk_p_title").value = p ? p.title || "" : "";
    document.querySelector("#tk_p_type").value = p ? p.type : "video";
    document.querySelector("#tk_p_date").value = p ? p.date || "" : new Date().toISOString().slice(0, 10);
    document.querySelector("#tk_p_duration").value = p ? p.duration || "" : "";
    document.querySelector("#tk_p_slides").value = p ? p.slides || "" : "";
    document.querySelector("#tk_p_amount").value = p ? p.amount : "";
    document.querySelector("#tk_p_received").value = p ? p.received : 0;
    document.querySelector("#tk_p_status").value = p ? p.status : "pending";
    document.querySelector("#tk_p_bank").value = p ? p.bankId || "" : "";
    document.querySelector("#tk-project-status").textContent = "";
    toggleTypeFields();
    updatePendingPreview();
    projectModal.classList.add("open");
  }

  function closeProjectModal() {
    projectModal.classList.remove("open");
  }

  document.querySelectorAll(".tk-new-project-btn").forEach((btn) => btn.addEventListener("click", () => openProjectModal(null)));
  document.querySelector("#tk-project-modal-close").addEventListener("click", closeProjectModal);
  projectModal.addEventListener("click", (e) => { if (e.target === projectModal) closeProjectModal(); });
  document.querySelector("#tk_p_type").addEventListener("change", toggleTypeFields);
  document.querySelector("#tk_p_amount").addEventListener("input", updatePendingPreview);
  document.querySelector("#tk_p_received").addEventListener("input", updatePendingPreview);

  document.querySelector("#tk-save-project-btn").addEventListener("click", async () => {
    const id = document.querySelector("#tk_p_id").value;
    const title = document.querySelector("#tk_p_title").value.trim();
    const status = document.querySelector("#tk-project-status");
    if (!title) {
      status.textContent = "Please add a project title.";
      return;
    }
    const data = {
      client: document.querySelector("#tk_p_client").value.trim(),
      title,
      type: document.querySelector("#tk_p_type").value,
      date: document.querySelector("#tk_p_date").value,
      duration: document.querySelector("#tk_p_duration").value.trim(),
      slides: document.querySelector("#tk_p_slides").value,
      amount: Number(document.querySelector("#tk_p_amount").value || 0),
      received: Number(document.querySelector("#tk_p_received").value || 0),
      status: document.querySelector("#tk_p_status").value,
      bankId: document.querySelector("#tk_p_bank").value,
    };
    const prevProject = id ? tkProjects.find((x) => x.id === id) : null;
    const paidNow = data.received - Number((prevProject && prevProject.received) || 0);
    try {
      if (id) {
        await updateDoc(doc(db, TRACKER_PROJECTS_COLLECTION, id), data);
      } else {
        data.serial = tkProjects.length ? Math.max(...tkProjects.map((p) => p.serial || 0)) + 1 : 1;
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, TRACKER_PROJECTS_COLLECTION), data);
      }
      if (paidNow > 0) await recordLastPayment(paidNow);
      closeProjectModal();
    } catch (err) {
      status.textContent = err.message || "Save failed — please try again.";
    }
  });

  // ---------- Record a payment (pick projects, amount adds up automatically) ----------
  const paySel = {}; // project id -> { on: boolean, amt: number }
  const payList = document.querySelector("#tk-pay-list");
  const payDate = document.querySelector("#tk_pay_date");
  payDate.value = todayLocal();

  function pendingOf(p) {
    return Math.max(0, Number(p.amount || 0) - Number(p.received || 0));
  }

  function updatePayTotal() {
    const total = Object.values(paySel).reduce((a, s) => a + (s.on ? Number(s.amt || 0) : 0), 0);
    document.querySelector("#tk-pay-total").textContent = fmt(total);
    return total;
  }

  function renderPayList() {
    const list = tkProjects.filter((p) => pendingOf(p) > 0).sort((a, b) => (a.serial || 0) - (b.serial || 0));
    Object.keys(paySel).forEach((id) => { if (!list.find((p) => p.id === id)) delete paySel[id]; });
    if (!list.length) {
      payList.innerHTML = `<p class="note" style="padding: 16px;">Nothing pending — every project is fully paid.</p>`;
      updatePayTotal();
      return;
    }
    payList.innerHTML = list
      .map((p) => {
        const pend = pendingOf(p);
        const s = paySel[p.id] || { on: false, amt: pend };
        if (s.amt > pend) s.amt = pend;
        paySel[p.id] = s;
        return `<div class="tk-check-row">
          <input type="checkbox" class="tk-pay-chk" value="${p.id}" ${s.on ? "checked" : ""} aria-label="Include ${esc(p.title)}">
          <span class="tk-grow">${esc(p.title)}<div class="tk-muted">#${p.serial} · ${esc(p.client || "—")} · ${fmt(pend)} pending</div></span>
          <input type="number" class="tk-pay-amt" data-id="${p.id}" min="0" max="${pend}" value="${s.amt}" aria-label="Amount paid for ${esc(p.title)}"
            style="width: 110px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; color: var(--text); font-family: var(--font-body); font-size: 14px;">
        </div>`;
      })
      .join("");
    updatePayTotal();
  }

  payList.addEventListener("change", (e) => {
    const t = e.target;
    if (t.classList.contains("tk-pay-chk")) {
      paySel[t.value].on = t.checked;
    } else if (t.classList.contains("tk-pay-amt")) {
      t.value = paySel[t.dataset.id].amt;
    }
    updatePayTotal();
  });

  payList.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.classList.contains("tk-pay-amt")) return;
    const p = tkProjects.find((x) => x.id === t.dataset.id);
    const max = p ? pendingOf(p) : 0;
    const v = Math.min(Math.max(Number(t.value || 0), 0), max);
    paySel[t.dataset.id].amt = v;
    updatePayTotal();
  });

  document.querySelector("#tk-pay-save-btn").addEventListener("click", async () => {
    const status = document.querySelector("#tk-pay-status");
    const picked = tkProjects.filter((p) => paySel[p.id] && paySel[p.id].on && paySel[p.id].amt > 0);
    if (!picked.length) {
      status.textContent = "Tick at least one project to record a payment.";
      return;
    }
    const date = payDate.value || todayLocal();
    const batch = writeBatch(db);
    let total = 0;
    picked.forEach((p) => {
      const amt = Math.min(paySel[p.id].amt, pendingOf(p));
      const received = Number(p.received || 0) + amt;
      const upd = { received };
      if (received >= Number(p.amount || 0)) upd.status = "cleared";
      batch.update(doc(db, TRACKER_PROJECTS_COLLECTION, p.id), upd);
      total += amt;
    });
    batch.set(doc(db, ...TRACKER_LASTPAY_DOC), {
      amount: total,
      date,
      projects: picked.map((p) => p.title || ""),
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      picked.forEach((p) => delete paySel[p.id]);
      payDate.value = todayLocal();
      status.textContent = "Payment of " + fmt(total) + " recorded.";
      setTimeout(() => (status.textContent = ""), 3500);
    } catch (err) {
      status.textContent = err.message || "Save failed — please try again.";
    }
  });

  // ---------- Last payment (manual correction) ----------
  document.querySelector("#tk-lp-save-btn").addEventListener("click", async () => {
    const status = document.querySelector("#tk-lp-status");
    const raw = document.querySelector("#tk_lp_amount").value;
    const amount = Number(raw);
    if (raw === "" || isNaN(amount) || amount < 0) {
      status.textContent = "Enter the amount you received.";
      return;
    }
    const date = document.querySelector("#tk_lp_date").value || todayLocal();
    try {
      await setDoc(doc(db, ...TRACKER_LASTPAY_DOC), { amount, date, updatedAt: serverTimestamp() });
      status.textContent = "Last payment updated.";
      setTimeout(() => (status.textContent = ""), 2500);
    } catch (err) {
      status.textContent = err.message || "Save failed — please try again.";
    }
  });

  // ---------- Settings ----------
  function addBankRow(b) {
    const wrap = document.querySelector("#tkBanksWrap");
    const id = (b && b.id) || "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    const row = document.createElement("div");
    row.className = "tk-bank-row";
    row.dataset.id = id;
    row.innerHTML = `
      <div class="field"><label>Bank name</label><input class="tk-bk-label" value="${esc(b ? b.label : "")}" placeholder="e.g. Canara Bank"></div>
      <div class="field"><label>Account number</label><input class="tk-bk-acc" value="${esc(b ? b.accNo : "")}" placeholder="Account number"></div>
      <div class="field"><label>IFSC code</label><input class="tk-bk-ifsc" value="${esc(b ? b.ifsc : "")}" placeholder="IFSC code"></div>
      <div class="field"><label>UPI ID</label><input class="tk-bk-upi" value="${esc(b ? b.upi : "")}" placeholder="name@bank"></div>
      <button class="tk-icon-btn" type="button">✕</button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    wrap.appendChild(row);
  }

  document.querySelector("#tk-add-bank-btn").addEventListener("click", () => addBankRow(null));

  function loadSettingsToForm() {
    document.querySelector("#tk_companyName").value = tkSettings.companyName || "";
    document.querySelector("#tk_companyTagline").value = tkSettings.companyTagline || "";
    document.querySelector("#tk_companyEmail").value = tkSettings.companyEmail || "";
    document.querySelector("#tk_companyPhone").value = tkSettings.companyPhone || "";
    document.querySelector("#tk_nextInvoice").value = tkSettings.nextInvoice || "";
    document.querySelector("#tk_terms").value = tkSettings.terms || "";
    document.querySelector("#tkLogoPreview").innerHTML = tkSettings.logo ? `<img src="${tkSettings.logo}">` : "—";
    document.querySelector("#tkSealPreview").innerHTML = tkSettings.seal ? `<img src="${tkSettings.seal}">` : "—";
    document.querySelector("#tkBanksWrap").innerHTML = "";
    (tkSettings.banks || []).forEach((b) => addBankRow(b));
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  document.querySelector("#tk_logoFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    tkSettings.logo = await readAsDataURL(f);
    document.querySelector("#tkLogoPreview").innerHTML = `<img src="${tkSettings.logo}">`;
  });

  document.querySelector("#tk_sealFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    tkSettings.seal = await readAsDataURL(f);
    document.querySelector("#tkSealPreview").innerHTML = `<img src="${tkSettings.seal}">`;
  });

  document.querySelector("#tk-save-settings-btn").addEventListener("click", async () => {
    const status = document.querySelector("#tk-settings-status");
    const updated = {
      companyName: document.querySelector("#tk_companyName").value.trim(),
      companyTagline: document.querySelector("#tk_companyTagline").value.trim(),
      companyEmail: document.querySelector("#tk_companyEmail").value.trim(),
      companyPhone: document.querySelector("#tk_companyPhone").value.trim(),
      nextInvoice: document.querySelector("#tk_nextInvoice").value.trim(),
      terms: document.querySelector("#tk_terms").value,
      logo: tkSettings.logo || "",
      seal: tkSettings.seal || "",
      banks: [...document.querySelectorAll(".tk-bank-row")].map((r) => ({
        id: r.dataset.id,
        label: r.querySelector(".tk-bk-label").value.trim(),
        accNo: r.querySelector(".tk-bk-acc").value.trim(),
        ifsc: r.querySelector(".tk-bk-ifsc").value.trim(),
        upi: r.querySelector(".tk-bk-upi").value.trim(),
      })),
    };
    try {
      await setDoc(doc(db, ...TRACKER_SETTINGS_DOC), updated, { merge: true });
      status.textContent = "Settings saved.";
      setTimeout(() => (status.textContent = ""), 2500);
    } catch (err) {
      status.textContent = err.message || "Save failed — please try again.";
    }
  });

  // ---------- Invoices ----------
  function bumpInvoiceNumber(full) {
    const m = (full || "").match(/^(.*?)(\d+)$/);
    if (!m) return full;
    const nextNum = (parseInt(m[2], 10) + 1).toString().padStart(m[2].length, "0");
    return m[1] + nextNum;
  }

  function pendingProjectsList() {
    return tkProjects.filter((p) => Math.max(0, Number(p.amount || 0) - Number(p.received || 0)) > 0).sort((a, b) => a.serial - b.serial);
  }

  const invoiceSelectModal = document.querySelector("#tk-invoice-select-modal");
  const invoicePreviewModal = document.querySelector("#tk-invoice-preview-modal");
  let selectedInvoiceItems = [];
  let selectedBillTo = "";

  document.querySelector("#tk-generate-invoice-btn").addEventListener("click", () => {
    const list = pendingProjectsList();
    document.querySelector("#tk_inv_billTo").value = list.length ? list[0].client || "" : "";
    const wrap = document.querySelector("#tk-invoice-select-list");
    wrap.innerHTML = list.length
      ? list
          .map((p) => {
            const pend = Math.max(0, Number(p.amount || 0) - Number(p.received || 0));
            return `<label class="tk-check-row">
              <input type="checkbox" class="tk-inv-chk" value="${p.id}" checked>
              <span class="tk-grow">${esc(p.title)}<div class="tk-muted">#${p.serial} · ${esc(p.client || "—")} · ${p.date || "—"}</div></span>
              <span>${fmt(pend)} due</span>
            </label>`;
          })
          .join("")
      : `<p class="note" style="padding: 16px;">Nothing pending — every project is fully paid.</p>`;
    invoiceSelectModal.classList.add("open");
  });

  document.querySelector("#tk-invoice-select-close").addEventListener("click", () => invoiceSelectModal.classList.remove("open"));
  invoiceSelectModal.addEventListener("click", (e) => { if (e.target === invoiceSelectModal) invoiceSelectModal.classList.remove("open"); });

  document.querySelector("#tk-toggle-all-invoice-btn").addEventListener("click", () => {
    const boxes = [...document.querySelectorAll(".tk-inv-chk")];
    const allChecked = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !allChecked));
  });

  document.querySelector("#tk-preview-invoice-btn").addEventListener("click", () => {
    const ids = [...document.querySelectorAll(".tk-inv-chk:checked")].map((b) => b.value);
    if (!ids.length) { alert("Select at least one project to invoice."); return; }
    selectedBillTo = document.querySelector("#tk_inv_billTo").value.trim() || "—";
    selectedInvoiceItems = tkProjects.filter((p) => ids.includes(p.id)).sort((a, b) => a.serial - b.serial);

    const invNum = tkSettings.nextInvoice || "#INV-01";
    const totalPend = selectedInvoiceItems.reduce((a, p) => a + Math.max(0, Number(p.amount || 0) - Number(p.received || 0)), 0);
    const bankIds = [...new Set(selectedInvoiceItems.map((p) => p.bankId).filter(Boolean))];
    const bank = (tkSettings.banks || []).find((b) => b.id === bankIds[0]) || (tkSettings.banks || [])[0];
    const termsList = (tkSettings.terms || "").split("\n").map((t) => t.trim()).filter(Boolean);

    const rows = selectedInvoiceItems
      .map((p) => {
        const price = Math.max(0, Number(p.amount || 0) - Number(p.received || 0));
        const qty = p.type === "video" ? esc(p.duration || "—") : (p.slides || 0) + " slides";
        return `<tr><td>${esc(p.title)}</td><td>${p.date || "—"}</td><td>${qty}</td><td>${fmt(price)}</td></tr>`;
      })
      .join("");

    document.querySelector("#tk-print-area").innerHTML = `
      <div class="tk-inv-head">
        <div class="tk-inv-head-left">
          ${tkSettings.logo ? `<img src="${tkSettings.logo}">` : ""}
          <div>
            <div class="tk-biz-name">${esc((tkSettings.companyName || "Your Company").toUpperCase())}</div>
            ${tkSettings.companyTagline ? `<div class="tk-biz-tagline">${esc(tkSettings.companyTagline)}</div>` : ""}
          </div>
        </div>
        <div class="tk-inv-head-right">
          <div class="tk-inv-label">INVOICE</div>
          <div class="tk-inv-num">${esc(invNum)}</div>
        </div>
      </div>
      <hr class="tk-inv-rule">
      <div class="tk-inv-2col">
        <div><h4>Bill To:</h4><div class="tk-val">${esc(selectedBillTo)}</div></div>
        <div style="text-align: right;">
          <h4>Invoice date</h4>
          <div class="tk-val">${new Date().toLocaleDateString("en-GB")}</div>
          <h4 style="margin-top: 12px;">Payment information</h4>
          <div class="tk-inv-pay">
            ${bank ? `<div><b>Bank Name:</b> ${esc(bank.label)}</div><div><b>IFSC Code:</b> ${esc(bank.ifsc)}</div><div><b>Account Number:</b> ${esc(bank.accNo)}</div><div><b>UPI ID:</b> ${esc(bank.upi)}</div>` : "Add a bank account in Settings."}
          </div>
        </div>
      </div>
      <div class="tk-inv-contact">
        <h4>Contact information</h4>
        <div>Email: ${esc(tkSettings.companyEmail || "—")}</div>
        <div>Phone: ${esc(tkSettings.companyPhone || "—")}</div>
      </div>
      <table class="tk-inv-table">
        <thead><tr><th>Type of service</th><th>Date submitted</th><th>Length/Quantity</th><th>Price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tk-inv-totals">
        <div><span>Subtotal:</span><span>${fmt(totalPend)}</span></div>
        <div class="tk-grand"><span>Total Amount Due:</span><span>${fmt(totalPend)}</span></div>
      </div>
      <div class="tk-inv-bottom">
        <div class="tk-inv-terms">
          <h4>Terms and Conditions</h4>
          ${termsList.length ? `<ul>${termsList.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        </div>
        ${tkSettings.seal ? `<img class="tk-inv-seal" src="${tkSettings.seal}">` : ""}
      </div>
      <div class="tk-inv-footer">
        <span>${esc(tkSettings.companyEmail || "")}</span>
        <span>Ph. no - ${esc(tkSettings.companyPhone || "")}</span>
      </div>`;

    invoiceSelectModal.classList.remove("open");
    invoicePreviewModal.classList.add("open");
  });

  document.querySelector("#tk-invoice-close-btn").addEventListener("click", () => invoicePreviewModal.classList.remove("open"));
  invoicePreviewModal.addEventListener("click", (e) => { if (e.target === invoicePreviewModal) invoicePreviewModal.classList.remove("open"); });
  document.querySelector("#tk-print-btn").addEventListener("click", () => window.print());

  document.querySelector("#tk-download-pdf-btn").addEventListener("click", () => {
    const el = document.querySelector("#tk-print-area");
    const invNum = (tkSettings.nextInvoice || "invoice").replace(/[^a-z0-9-]/gi, "");
    // eslint-disable-next-line no-undef
    html2pdf().set({
      margin: 0,
      filename: invNum + ".pdf",
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
    }).from(el).save();
  });

  document.querySelector("#tk-confirm-invoice-btn").addEventListener("click", async () => {
    if (!selectedInvoiceItems.length) return;
    const invNum = tkSettings.nextInvoice || "INV-001";
    const totalAmt = selectedInvoiceItems.reduce((a, p) => a + Number(p.amount || 0), 0);
    const totalPend = selectedInvoiceItems.reduce((a, p) => a + Math.max(0, Number(p.amount || 0) - Number(p.received || 0)), 0);
    try {
      await addDoc(collection(db, TRACKER_INVOICES_COLLECTION), {
        number: invNum,
        client: selectedBillTo,
        date: new Date().toISOString().slice(0, 10),
        items: selectedInvoiceItems.map((p) => ({ title: p.title, amount: p.amount })),
        total: totalAmt,
        pending: totalPend,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, ...TRACKER_SETTINGS_DOC), { nextInvoice: bumpInvoiceNumber(invNum) }, { merge: true });
      invoicePreviewModal.classList.remove("open");
      alert("Invoice " + invNum + " saved with " + selectedInvoiceItems.length + " project(s).");
    } catch (err) {
      alert(err.message || "Could not save the invoice — please try again.");
    }
  });
}
