import {
  db,
  auth,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  TRACKER_PROJECTS_COLLECTION,
  TRACKER_INVOICES_COLLECTION,
  TRACKER_SETTINGS_DOC
} from "./firebase-init.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ============================================================
// TRACKER STATE
// ============================================================

let tkProjects = [];

let tkSettings = {
  companyName: "",
  companyTagline: "",
  companyEmail: "",
  companyPhone: "",
  logo: "",
  seal: "",
  nextInvoice: "INV-001",
  banks: [],
  terms: ""
};

let tkInvoices = [];

let tkInitialized = false;
let trackerDataStarted = false;

let startTrackerData = () => {};


// ============================================================
// CLOUDINARY
// ============================================================

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function prettySize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

async function uploadImageToCloudinary(file) {

  if (!file) {
    throw new Error("No image selected.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `"${file.name}" is ${prettySize(file.size)}. ` +
      `Please use an image under 10MB.`
    );
  }

  const url =
    `https://api.cloudinary.com/v1_1/` +
    `${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const formData = new FormData();

  formData.append("file", file);
  formData.append(
    "upload_preset",
    CLOUDINARY_UPLOAD_PRESET
  );

  const response = await fetch(
    url,
    {
      method: "POST",
      body: formData
    }
  );

  const data =
    await response
      .json()
      .catch(() => null);

  if (!response.ok) {

    const reason =
      data &&
      data.error &&
      data.error.message

        ? data.error.message

        : `Upload failed (HTTP ${response.status})`;

    throw new Error(reason);
  }

  if (!data || !data.secure_url) {
    throw new Error(
      "Cloudinary did not return an image URL."
    );
  }

  return data.secure_url;
}


// ============================================================
// SAFETY CSS
// ============================================================

const trackerSafetyStyle =
  document.createElement("style");

trackerSafetyStyle.textContent = `

  .lightbox-overlay:not(.open) {
    display: none !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }

  .lightbox-overlay.open {
    pointer-events: auto !important;
    visibility: visible !important;
  }

  #tracker-panel {
    position: relative;
    z-index: 10;
    pointer-events: auto !important;
  }

  #tracker-panel button,
  #tracker-panel input,
  #tracker-panel select,
  #tracker-panel textarea {
    pointer-events: auto !important;
  }

  .tk-subtab,
  .tk-new-project-btn,
  .tk-tabs button,
  #tk-generate-invoice-btn,
  #tk-add-bank-btn,
  #tk-save-settings-btn {
    position: relative;
    z-index: 20;
    pointer-events: auto !important;
    cursor: pointer !important;
  }

`;

document.head.appendChild(
  trackerSafetyStyle
);


// ============================================================
// HELPERS
// ============================================================

function fmt(n) {

  return (
    "₹" +
    (Number(n) || 0)
      .toLocaleString("en-IN")
  );

}

function esc(s) {

  const div =
    document.createElement("div");

  div.textContent = s || "";

  return div.innerHTML;

}


// ============================================================
// TRACKER UI BOOT
// ============================================================

function bootTrackerUI() {

  if (tkInitialized) {
    return;
  }

  tkInitialized = true;

  try {

    initTracker();

    console.log(
      "AKSHUTO Tracker UI initialized."
    );

  } catch (error) {

    console.error(
      "AKSHUTO Tracker initialization failed:",
      error
    );

    const panel =
      document.querySelector(
        "#tracker-panel"
      );

    if (panel) {

      const errorBox =
        document.createElement("div");

      errorBox.style.cssText = `
        margin: 20px 0;
        padding: 16px;
        border: 1px solid #ff4d00;
        border-radius: 10px;
        background: rgba(255, 77, 0, 0.08);
        color: #ff6a2a;
        font-family: monospace;
        white-space: pre-wrap;
      `;

      errorBox.textContent =
        "Tracker JavaScript error:\n\n" +
        (
          error?.stack ||
          error?.message ||
          String(error)
        );

      panel.prepend(
        errorBox
      );
    }
  }

}


// ============================================================
// MAIN INITIALIZATION
// ============================================================

function initTracker() {

  // ==========================================================
  // SUB-TABS
  // ==========================================================

  document
    .querySelectorAll(".tk-subtab")
    .forEach((tab) => {

      tab.addEventListener(
        "click",
        (event) => {

          event.preventDefault();
          event.stopPropagation();

          const targetId =
            tab.dataset.tksection;

          const target =
            document.querySelector(
              "#" + targetId
            );

          if (!target) {

            console.error(
              "Tracker section not found:",
              targetId
            );

            return;
          }

          document
            .querySelectorAll(".tk-subtab")
            .forEach((t) => {

              t.classList.remove(
                "active"
              );

            });

          document
            .querySelectorAll(".tk-section")
            .forEach((section) => {

              section.style.display =
                "none";

            });

          tab.classList.add(
            "active"
          );

          target.style.display =
            "block";

        }
      );

    });


  // ==========================================================
  // FIRESTORE LISTENERS
  // ==========================================================

  startTrackerData =
    function () {

      if (
        trackerDataStarted ||
        !auth.currentUser
      ) {
        return;
      }

      trackerDataStarted = true;


      // --------------------------------------------------------
      // PROJECTS
      // --------------------------------------------------------

      onSnapshot(

        collection(
          db,
          TRACKER_PROJECTS_COLLECTION
        ),

        (snap) => {

          tkProjects =
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data()
              })
            );

          renderAll();

        },

        (err) => {

          console.error(
            "Tracker projects listener:",
            err
          );

        }

      );


      // --------------------------------------------------------
      // SETTINGS
      // --------------------------------------------------------

      onSnapshot(

        doc(
          db,
          ...TRACKER_SETTINGS_DOC
        ),

        (snap) => {

          if (snap.exists()) {

            tkSettings = {
              ...tkSettings,
              ...snap.data(),
              banks: [
                ...(
                  snap.data().banks ||
                  []
                )
              ]
            };

            loadSettingsToForm();

          }

          renderAll();

        },

        (err) => {

          console.error(
            "Tracker settings listener:",
            err
          );

        }

      );


      // --------------------------------------------------------
      // INVOICES
      // --------------------------------------------------------

      onSnapshot(

        collection(
          db,
          TRACKER_INVOICES_COLLECTION
        ),

        (snap) => {

          tkInvoices =
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data()
              })
            );

          renderInvoices();

        },

        (err) => {

          console.error(
            "Tracker invoices listener:",
            err
          );

        }

      );

    };


  // ==========================================================
  // STATUS FILTERS
  // ==========================================================

  let activeFilter = "all";

  const statusTabs =
    document.querySelector(
      "#tkStatusTabs"
    );

  if (statusTabs) {

    statusTabs.addEventListener(
      "click",
      (e) => {

        if (
          e.target.tagName !==
          "BUTTON"
        ) {
          return;
        }

        document
          .querySelectorAll(
            "#tkStatusTabs button"
          )
          .forEach((b) => {

            b.classList.remove(
              "active"
            );

          });

        e.target.classList.add(
          "active"
        );

        activeFilter =
          e.target.dataset.f;

        renderProjects(
          activeFilter
        );

      }
    );

  }


  // ==========================================================
  // RENDER ALL
  // ==========================================================

  function renderAll() {

    renderDashboard();

    renderProjects(
      activeFilter
    );

    renderInvoices();

  }


  // ==========================================================
  // STATUS BADGE
  // ==========================================================

  function statusBadge(s) {

    const map = {
      pending: "Pending",
      process: "In process",
      cleared: "Cleared"
    };

    return `
      <span class="tk-status ${s}">
        ${map[s] || s}
      </span>
    `;

  }


  // ==========================================================
  // PROJECT TABLE
  // ==========================================================

  function projectsTable(
    list,
    withActions
  ) {

    if (!list.length) {

      return `
        <p class="note">
          No projects yet — add your first one above.
        </p>
      `;

    }


    const rows =
      list
        .map((p) => {

          const unit =
            p.type === "video"

              ? (
                  p.duration
                    ? esc(p.duration)
                    : "—"
                )

              : p.slides
                ? `${p.slides} slides`
                : "—";


          const pending =
            Math.max(
              0,
              Number(p.amount || 0) -
              Number(p.received || 0)
            );


          return `

            <tr>

              <td>
                ${p.serial || "—"}
              </td>

              <td>

                ${esc(
                  p.title
                )}

                <div
                  style="
                    color: var(--muted);
                    font-size: 12px;
                  "
                >
                  ${esc(
                    p.client || ""
                  )}
                </div>

              </td>

              <td>
                ${p.date || "—"}
              </td>

              <td>
                ${unit}
              </td>

              <td>
                ${fmt(p.amount)}
              </td>

              <td>
                ${fmt(pending)}
              </td>

              <td>
                ${statusBadge(
                  p.status
                )}
              </td>

              ${
                withActions

                  ? `

                    <td>

                      <div
                        class="tk-row-actions"
                      >

                        <button
                          class="tk-icon-btn"
                          data-tk-edit="${p.id}"
                          title="Edit"
                          type="button"
                        >
                          ✎
                        </button>

                        <button
                          class="tk-icon-btn"
                          data-tk-delete="${p.id}"
                          title="Delete"
                          type="button"
                        >
                          ✕
                        </button>

                      </div>

                    </td>

                  `

                  : ""
              }

            </tr>

          `;

        })
        .join("");


    return `

      <table class="tk-table">

        <thead>

          <tr>

            <th>#</th>
            <th>Project</th>
            <th>Date</th>
            <th>Duration/Slides</th>
            <th>Amount</th>
            <th>Pending</th>
            <th>Status</th>

            ${
              withActions
                ? "<th></th>"
                : ""
            }

          </tr>

        </thead>

        <tbody>
          ${rows}
        </tbody>

      </table>

    `;

  }


  // ==========================================================
  // ROW ACTIONS
  // ==========================================================

  function wireRowActions(
    container
  ) {

    container
      .querySelectorAll(
        "[data-tk-edit]"
      )
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          () => {

            openProjectModal(
              btn.dataset.tkEdit
            );

          }
        );

      });


    container
      .querySelectorAll(
        "[data-tk-delete]"
      )
      .forEach((btn) => {

        btn.addEventListener(
          "click",
          async () => {

            if (
              !confirm(
                "Delete this project?"
              )
            ) {
              return;
            }

            try {

              await deleteDoc(

                doc(
                  db,
                  TRACKER_PROJECTS_COLLECTION,
                  btn.dataset.tkDelete
                )

              );

            } catch (err) {

              console.error(
                "Delete project error:",
                err
              );

              alert(
                err.message ||
                "Could not delete the project."
              );

            }

          }
        );

      });

  }


  // ==========================================================
  // DASHBOARD
  // ==========================================================

  function renderDashboard() {

    const total =
      tkProjects.reduce(
        (a, p) =>
          a + Number(
            p.amount || 0
          ),
        0
      );


    const received =
      tkProjects.reduce(
        (a, p) =>
          a + Number(
            p.received || 0
          ),
        0
      );


    const pending =
      total - received;


    const inProcess =
      tkProjects.filter(
        (p) =>
          p.status ===
          "process"
      ).length;


    const cards =
      document.querySelector(
        "#tkStatCards"
      );


    if (cards) {

      cards.innerHTML = `

        <div class="tk-card">

          <div class="tk-label">
            Total billed
          </div>

          <div class="tk-num">
            ${fmt(total)}
          </div>

        </div>


        <div class="tk-card ok">

          <div class="tk-label">
            Cleared
          </div>

          <div class="tk-num">
            ${fmt(received)}
          </div>

        </div>


        <div class="tk-card wait">

          <div class="tk-label">
            Pending
          </div>

          <div class="tk-num">
            ${fmt(pending)}
          </div>

        </div>


        <div class="tk-card">

          <div class="tk-label">
            Projects in process
          </div>

          <div class="tk-num">
            ${inProcess}
          </div>

        </div>

      `;

    }


    const recent =
      [...tkProjects]
        .sort(
          (a, b) =>
            (b.date || "")
              .localeCompare(
                a.date || ""
              )
        )
        .slice(
          0,
          5
        );


    const wrap =
      document.querySelector(
        "#tkRecentTableWrap"
      );


    if (wrap) {

      wrap.innerHTML =
        projectsTable(
          recent,
          false
        );

    }

  }


  // ==========================================================
  // PROJECTS
  // ==========================================================

  function renderProjects(
    filter
  ) {

    let list =
      [...tkProjects].sort(
        (a, b) =>
          (a.serial || 0) -
          (b.serial || 0)
      );


    if (
      filter &&
      filter !== "all"
    ) {

      list =
        list.filter(
          (p) =>
            p.status === filter
        );

    }


    const wrap =
      document.querySelector(
        "#tkProjectsTableWrap"
      );


    if (!wrap) {
      return;
    }


    wrap.innerHTML =
      projectsTable(
        list,
        true
      );


    wireRowActions(
      wrap
    );

  }


  // ==========================================================
  // INVOICES
  // ==========================================================

  function renderInvoices() {

    const wrap =
      document.querySelector(
        "#tkInvoicesTableWrap"
      );


    if (!wrap) {
      return;
    }


    if (!tkInvoices.length) {

      wrap.innerHTML = `

        <p class="note">
          No invoices generated yet —
          generate one from the Invoices tab.
        </p>

      `;

      return;

    }


    const rows =
      [...tkInvoices]
        .reverse()
        .map(
          (iv) => `

            <tr>

              <td>
                ${esc(
                  iv.number
                )}
              </td>

              <td>
                ${esc(
                  iv.client
                )}
              </td>

              <td>
                ${iv.date || "—"}
              </td>

              <td>
                ${
                  (iv.items || [])
                    .map(
                      (i) =>
                        esc(i.title)
                    )
                    .join(", ")
                }
              </td>

              <td>
                ${fmt(
                  iv.total
                )}
              </td>

            </tr>

          `
        )
        .join("");


    wrap.innerHTML = `

      <table class="tk-table">

        <thead>

          <tr>

            <th>Invoice #</th>
            <th>Client</th>
            <th>Date</th>
            <th>Items</th>
            <th>Total</th>

          </tr>

        </thead>

        <tbody>
          ${rows}
        </tbody>

      </table>

    `;

  }


  // ==========================================================
  // PROJECT MODAL
  // ==========================================================

  const projectModal =
    document.querySelector(
      "#tk-project-modal"
    );


  function toggleTypeFields() {

    const type =
      document.querySelector(
        "#tk_p_type"
      );


    if (!type) {
      return;
    }


    const isVideo =
      type.value === "video";


    const durationWrap =
      document.querySelector(
        "#tk_p_durationWrap"
      );


    const slidesWrap =
      document.querySelector(
        "#tk_p_slidesWrap"
      );


    if (durationWrap) {

      durationWrap.style.display =
        isVideo
          ? "block"
          : "none";

    }


    if (slidesWrap) {

      slidesWrap.style.display =
        isVideo
          ? "none"
          : "block";

    }

  }


  function updatePendingPreview() {

    const amount =
      Number(
        document.querySelector(
          "#tk_p_amount"
        )?.value || 0
      );


    const received =
      Number(
        document.querySelector(
          "#tk_p_received"
        )?.value || 0
      );


    const preview =
      document.querySelector(
        "#tk-pending-preview"
      );


    if (preview) {

      preview.textContent =
        "Pending: " +
        fmt(
          Math.max(
            0,
            amount - received
          )
        );

    }

  }


  function fillBankSelect() {

    const select =
      document.querySelector(
        "#tk_p_bank"
      );


    if (!select) {
      return;
    }


    select.innerHTML =
      '<option value="">— none —</option>' +

      (
        tkSettings.banks ||
        []
      )
        .map(
          (b) => `

            <option
              value="${b.id}"
            >
              ${esc(
                b.label
              )}
            </option>

          `
        )
        .join("");

  }


  function openProjectModal(
    id
  ) {

    if (!projectModal) {
      return;
    }


    fillBankSelect();


    const p =
      id
        ? tkProjects.find(
            (x) => x.id === id
          )
        : null;


    document.querySelector(
      "#tk-project-modal-title"
    ).textContent =
      id
        ? "Edit project"
        : "New project";


    document.querySelector(
      "#tk_p_id"
    ).value =
      id || "";


    document.querySelector(
      "#tk_p_client"
    ).value =
      p?.client || "";


    document.querySelector(
      "#tk_p_title"
    ).value =
      p?.title || "";


    document.querySelector(
      "#tk_p_type"
    ).value =
      p?.type || "video";


    document.querySelector(
      "#tk_p_date"
    ).value =
      p
        ? (
            p.date || ""
          )
        : new Date()
            .toISOString()
            .slice(
              0,
              10
            );


    document.querySelector(
      "#tk_p_duration"
    ).value =
      p?.duration || "";


    document.querySelector(
      "#tk_p_slides"
    ).value =
      p?.slides || "";


    document.querySelector(
      "#tk_p_amount"
    ).value =
      p
        ? p.amount
        : "";


    document.querySelector(
      "#tk_p_received"
    ).value =
      p
        ? p.received
        : 0;


    document.querySelector(
      "#tk_p_status"
    ).value =
      p?.status ||
      "pending";


    document.querySelector(
      "#tk_p_bank"
    ).value =
      p?.bankId || "";


    document.querySelector(
      "#tk-project-status"
    ).textContent =
      "";


    toggleTypeFields();

    updatePendingPreview();


    projectModal.classList.add(
      "open"
    );

  }


  function closeProjectModal() {

    if (!projectModal) {
      return;
    }

    projectModal.classList.remove(
      "open"
    );

  }


  // ==========================================================
  // NEW PROJECT BUTTONS
  // ==========================================================

  document
    .querySelectorAll(
      ".tk-new-project-btn"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          openProjectModal(
            null
          );

        }
      );

    });


  // ==========================================================
  // CLOSE PROJECT MODAL
  // ==========================================================

  const projectModalClose =
    document.querySelector(
      "#tk-project-modal-close"
    );


  if (projectModalClose) {

    projectModalClose.addEventListener(
      "click",
      closeProjectModal
    );

  }


  if (projectModal) {

    projectModal.addEventListener(
      "click",
      (e) => {

        if (
          e.target ===
          projectModal
        ) {

          closeProjectModal();

        }

      }
    );

  }


  // ==========================================================
  // PROJECT INPUTS
  // ==========================================================

  const projectType =
    document.querySelector(
      "#tk_p_type"
    );


  if (projectType) {

    projectType.addEventListener(
      "change",
      toggleTypeFields
    );

  }


  const projectAmount =
    document.querySelector(
      "#tk_p_amount"
    );


  if (projectAmount) {

    projectAmount.addEventListener(
      "input",
      updatePendingPreview
    );

  }


  const projectReceived =
    document.querySelector(
      "#tk_p_received"
    );


  if (projectReceived) {

    projectReceived.addEventListener(
      "input",
      updatePendingPreview
    );

  }


  // ==========================================================
  // SAVE PROJECT
  // ==========================================================

  const saveProjectBtn =
    document.querySelector(
      "#tk-save-project-btn"
    );


  if (saveProjectBtn) {

    saveProjectBtn.addEventListener(
      "click",
      async () => {

        const id =
          document.querySelector(
            "#tk_p_id"
          ).value;


        const title =
          document.querySelector(
            "#tk_p_title"
          ).value.trim();


        const status =
          document.querySelector(
            "#tk-project-status"
          );


        if (!title) {

          status.textContent =
            "Please add a project title.";

          return;

        }


        const data = {

          client:
            document.querySelector(
              "#tk_p_client"
            ).value.trim(),

          title,

          type:
            document.querySelector(
              "#tk_p_type"
            ).value,

          date:
            document.querySelector(
              "#tk_p_date"
            ).value,

          duration:
            document.querySelector(
              "#tk_p_duration"
            ).value.trim(),

          slides:
            document.querySelector(
              "#tk_p_slides"
            ).value,

          amount:
            Number(
              document.querySelector(
                "#tk_p_amount"
              ).value || 0
            ),

          received:
            Number(
              document.querySelector(
                "#tk_p_received"
              ).value || 0
            ),

          status:
            document.querySelector(
              "#tk_p_status"
            ).value,

          bankId:
            document.querySelector(
              "#tk_p_bank"
            ).value

        };


        try {

          if (id) {

            await updateDoc(

              doc(
                db,
                TRACKER_PROJECTS_COLLECTION,
                id
              ),

              data

            );

          } else {

            data.serial =
              tkProjects.length

                ? Math.max(
                    ...tkProjects.map(
                      (p) =>
                        p.serial || 0
                    )
                  ) + 1

                : 1;


            data.createdAt =
              serverTimestamp();


            await addDoc(

              collection(
                db,
                TRACKER_PROJECTS_COLLECTION
              ),

              data

            );

          }


          closeProjectModal();


        } catch (err) {

          console.error(
            "Save project error:",
            err
          );


          status.textContent =
            err.message ||
            "Save failed — please try again.";

        }

      }
    );

  }


  // ==========================================================
  // SETTINGS
  // ==========================================================

  function addBankRow(b) {

    const wrap =
      document.querySelector(
        "#tkBanksWrap"
      );


    if (!wrap) {
      return;
    }


    const id =
      (
        b &&
        b.id
      ) ||

      (
        "b" +
        Date.now() +
        Math.random()
          .toString(36)
          .slice(2, 6)
      );


    const row =
      document.createElement(
        "div"
      );


    row.className =
      "tk-bank-row";


    row.dataset.id =
      id;


    row.innerHTML = `

      <div class="field">

        <label>
          Bank name
        </label>

        <input
          class="tk-bk-label"
          value="${esc(
            b
              ? b.label
              : ""
          )}"
          placeholder="e.g. Canara Bank"
        >

      </div>


      <div class="field">

        <label>
          Account number
        </label>

        <input
          class="tk-bk-acc"
          value="${esc(
            b
              ? b.accNo
              : ""
          )}"
          placeholder="Account number"
        >

      </div>


      <div class="field">

        <label>
          IFSC code
        </label>

        <input
          class="tk-bk-ifsc"
          value="${esc(
            b
              ? b.ifsc
              : ""
          )}"
          placeholder="IFSC code"
        >

      </div>


      <div class="field">

        <label>
          UPI ID
        </label>

        <input
          class="tk-bk-upi"
          value="${esc(
            b
              ? b.upi
              : ""
          )}"
          placeholder="name@bank"
        >

      </div>


      <button
        class="tk-icon-btn"
        type="button"
      >
        ✕
      </button>

    `;


    const removeBtn =
      row.querySelector(
        "button"
      );


    if (removeBtn) {

      removeBtn.addEventListener(
        "click",
        () => row.remove()
      );

    }


    wrap.appendChild(
      row
    );

  }


  // ==========================================================
  // ADD BANK
  // ==========================================================

  const addBankBtn =
    document.querySelector(
      "#tk-add-bank-btn"
    );


  if (addBankBtn) {

    addBankBtn.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        addBankRow(
          null
        );

      }
    );

  }


  // ==========================================================
  // LOAD SETTINGS
  // ==========================================================

  function loadSettingsToForm() {

    const companyName =
      document.querySelector(
        "#tk_companyName"
      );


    const companyTagline =
      document.querySelector(
        "#tk_companyTagline"
      );


    const companyEmail =
      document.querySelector(
        "#tk_companyEmail"
      );


    const companyPhone =
      document.querySelector(
        "#tk_companyPhone"
      );


    const nextInvoice =
      document.querySelector(
        "#tk_nextInvoice"
      );


    const terms =
      document.querySelector(
        "#tk_terms"
      );


    const logoPreview =
      document.querySelector(
        "#tkLogoPreview"
      );


    const sealPreview =
      document.querySelector(
        "#tkSealPreview"
      );


    const banksWrap =
      document.querySelector(
        "#tkBanksWrap"
      );


    if (companyName) {

      companyName.value =
        tkSettings.companyName ||
        "";

    }


    if (companyTagline) {

      companyTagline.value =
        tkSettings.companyTagline ||
        "";

    }


    if (companyEmail) {

      companyEmail.value =
        tkSettings.companyEmail ||
        "";

    }


    if (companyPhone) {

      companyPhone.value =
        tkSettings.companyPhone ||
        "";

    }


    if (nextInvoice) {

      nextInvoice.value =
        tkSettings.nextInvoice ||
        "";

    }


    if (terms) {

      terms.value =
        tkSettings.terms ||
        "";

    }


    if (logoPreview) {

      logoPreview.innerHTML =
        tkSettings.logo

          ? `
            <img
              src="${tkSettings.logo}"
              alt="Company logo"
            >
          `

          : "—";

    }


    if (sealPreview) {

      sealPreview.innerHTML =
        tkSettings.seal

          ? `
            <img
              src="${tkSettings.seal}"
              alt="Company seal"
            >
          `

          : "—";

    }


    if (banksWrap) {

      banksWrap.innerHTML =
        "";

      (
        tkSettings.banks ||
        []
      ).forEach(
        (b) =>
          addBankRow(
            b
          )
      );

    }

  }


  // ==========================================================
  // COMPANY LOGO UPLOAD
  // ==========================================================

  const logoFile =
    document.querySelector(
      "#tk_logoFile"
    );


  if (logoFile) {

    logoFile.addEventListener(
      "change",
      async (e) => {

        const file =
          e.target.files[0];


        if (!file) {
          return;
        }


        const preview =
          document.querySelector(
            "#tkLogoPreview"
          );


        if (preview) {

          preview.textContent =
            "Uploading...";

        }


        try {

          const imageUrl =
            await uploadImageToCloudinary(
              file
            );


          // IMPORTANT:
          // Store ONLY the Cloudinary URL.
          tkSettings.logo =
            imageUrl;


          if (preview) {

            preview.innerHTML = `

              <img
                src="${imageUrl}"
                alt="Company logo"
              >

            `;

          }


        } catch (err) {

          console.error(
            "Logo upload error:",
            err
          );


          if (preview) {

            preview.textContent =
              err.message ||
              "Logo upload failed.";

          }

        }


        e.target.value =
          "";

      }
    );

  }


  // ==========================================================
  // COMPANY SEAL UPLOAD
  // ==========================================================

  const sealFile =
    document.querySelector(
      "#tk_sealFile"
    );


  if (sealFile) {

    sealFile.addEventListener(
      "change",
      async (e) => {

        const file =
          e.target.files[0];


        if (!file) {
          return;
        }


        const preview =
          document.querySelector(
            "#tkSealPreview"
          );


        if (preview) {

          preview.textContent =
            "Uploading...";

        }


        try {

          const imageUrl =
            await uploadImageToCloudinary(
              file
            );


          // IMPORTANT:
          // Store ONLY the Cloudinary URL.
          tkSettings.seal =
            imageUrl;


          if (preview) {

            preview.innerHTML = `

              <img
                src="${imageUrl}"
                alt="Company seal"
              >

            `;

          }


        } catch (err) {

          console.error(
            "Seal upload error:",
            err
          );


          if (preview) {

            preview.textContent =
              err.message ||
              "Seal upload failed.";

          }

        }


        e.target.value =
          "";

      }
    );

  }


  // ==========================================================
  // SAVE SETTINGS
  // ==========================================================

  const saveSettingsBtn =
    document.querySelector(
      "#tk-save-settings-btn"
    );


  if (saveSettingsBtn) {

    saveSettingsBtn.addEventListener(
      "click",
      async () => {

        const status =
          document.querySelector(
            "#tk-settings-status"
          );


        const updated = {

          companyName:
            document.querySelector(
              "#tk_companyName"
            ).value.trim(),

          companyTagline:
            document.querySelector(
              "#tk_companyTagline"
            ).value.trim(),

          companyEmail:
            document.querySelector(
              "#tk_companyEmail"
            ).value.trim(),

          companyPhone:
            document.querySelector(
              "#tk_companyPhone"
            ).value.trim(),

          nextInvoice:
            document.querySelector(
              "#tk_nextInvoice"
            ).value.trim(),

          terms:
            document.querySelector(
              "#tk_terms"
            ).value,

          // THESE ARE NOW URLS,
          // NOT BASE64 IMAGES.
          logo:
            tkSettings.logo ||
            "",

          seal:
            tkSettings.seal ||
            "",

          banks:
            [
              ...document.querySelectorAll(
                ".tk-bank-row"
              )
            ].map(
              (r) => ({

                id:
                  r.dataset.id,

                label:
                  r.querySelector(
                    ".tk-bk-label"
                  ).value.trim(),

                accNo:
                  r.querySelector(
                    ".tk-bk-acc"
                  ).value.trim(),

                ifsc:
                  r.querySelector(
                    ".tk-bk-ifsc"
                  ).value.trim(),

                upi:
                  r.querySelector(
                    ".tk-bk-upi"
                  ).value.trim()

              })
            )

        };


        try {

          await setDoc(

            doc(
              db,
              ...TRACKER_SETTINGS_DOC
            ),

            updated,

            {
              merge: true
            }

          );


          if (status) {

            status.textContent =
              "Settings saved.";

            setTimeout(
              () => {

                status.textContent =
                  "";

              },
              2500
            );

          }


        } catch (err) {

          console.error(
            "Settings save error:",
            err
          );


          if (status) {

            status.textContent =
              err.message ||
              "Save failed — please try again.";

          }

        }

      }
    );

  }


  // ==========================================================
  // INVOICE HELPERS
  // ==========================================================

  function bumpInvoiceNumber(
    full
  ) {

    const match =
      (full || "")
        .match(
          /^(.*?)(\d+)$/
        );


    if (!match) {
      return full;
    }


    const nextNum =
      (
        parseInt(
          match[2],
          10
        ) + 1
      )
        .toString()
        .padStart(
          match[2].length,
          "0"
        );


    return (
      match[1] +
      nextNum
    );

  }


  function pendingProjectsList() {

    return tkProjects

      .filter(
        (p) =>
          Math.max(
            0,
            Number(
              p.amount || 0
            ) -
            Number(
              p.received || 0
            )
          ) > 0
      )

      .sort(
        (a, b) =>
          (a.serial || 0) -
          (b.serial || 0)
      );

  }


  // ==========================================================
  // INVOICE MODALS
  // ==========================================================

  const invoiceSelectModal =
    document.querySelector(
      "#tk-invoice-select-modal"
    );


  const invoicePreviewModal =
    document.querySelector(
      "#tk-invoice-preview-modal"
    );


  let selectedInvoiceItems = [];

  let selectedBillTo = "";


  // ==========================================================
  // GENERATE INVOICE
  // ==========================================================

  const generateInvoiceBtn =
    document.querySelector(
      "#tk-generate-invoice-btn"
    );


  if (generateInvoiceBtn) {

    generateInvoiceBtn.addEventListener(
      "click",
      (event) => {

        event.preventDefault();


        const list =
          pendingProjectsList();


        const billTo =
          document.querySelector(
            "#tk_inv_billTo"
          );


        if (billTo) {

          billTo.value =
            list.length
              ? list[0].client || ""
              : "";

        }


        const wrap =
          document.querySelector(
            "#tk-invoice-select-list"
          );


        if (!wrap) {
          return;
        }


        wrap.innerHTML =
          list.length

            ? list
                .map(
                  (p) => {

                    const pending =
                      Math.max(
                        0,
                        Number(
                          p.amount || 0
                        ) -
                        Number(
                          p.received || 0
                        )
                      );


                    return `

                      <label
                        class="tk-check-row"
                      >

                        <input
                          type="checkbox"
                          class="tk-inv-chk"
                          value="${p.id}"
                          checked
                        >

                        <span
                          class="tk-grow"
                        >

                          ${esc(
                            p.title
                          )}

                          <div
                            class="tk-muted"
                          >
                            #${p.serial}
                            ·
                            ${esc(
                              p.client ||
                              "—"
                            )}
                            ·
                            ${p.date ||
                              "—"}
                          </div>

                        </span>

                        <span>
                          ${fmt(
                            pending
                          )}
                          due
                        </span>

                      </label>

                    `;

                  }
                )
                .join("")

            : `

              <p
                class="note"
                style="padding: 16px;"
              >
                Nothing pending —
                every project is fully paid.
              </p>

            `;


        if (invoiceSelectModal) {

          invoiceSelectModal.classList.add(
            "open"
          );

        }

      }
    );

  }


  // ==========================================================
  // CLOSE INVOICE SELECT
  // ==========================================================

  const invoiceSelectClose =
    document.querySelector(
      "#tk-invoice-select-close"
    );


  if (invoiceSelectClose) {

    invoiceSelectClose.addEventListener(
      "click",
      () => {

        if (invoiceSelectModal) {

          invoiceSelectModal.classList.remove(
            "open"
          );

        }

      }
    );

  }


  if (invoiceSelectModal) {

    invoiceSelectModal.addEventListener(
      "click",
      (e) => {

        if (
          e.target ===
          invoiceSelectModal
        ) {

          invoiceSelectModal.classList.remove(
            "open"
          );

        }

      }
    );

  }


  // ==========================================================
  // TOGGLE ALL INVOICE ITEMS
  // ==========================================================

  const toggleAllInvoiceBtn =
    document.querySelector(
      "#tk-toggle-all-invoice-btn"
    );


  if (toggleAllInvoiceBtn) {

    toggleAllInvoiceBtn.addEventListener(
      "click",
      () => {

        const boxes =
          [
            ...document.querySelectorAll(
              ".tk-inv-chk"
            )
          ];


        const allChecked =
          boxes.length > 0 &&
          boxes.every(
            (b) =>
              b.checked
          );


        boxes.forEach(
          (b) => {

            b.checked =
              !allChecked;

          }
        );

      }
    );

  }


  // ==========================================================
  // PREVIEW INVOICE
  // ==========================================================

  const previewInvoiceBtn =
    document.querySelector(
      "#tk-preview-invoice-btn"
    );


  if (previewInvoiceBtn) {

    previewInvoiceBtn.addEventListener(
      "click",
      () => {

        const ids =
          [
            ...document.querySelectorAll(
              ".tk-inv-chk:checked"
            )
          ]
            .map(
              (b) =>
                b.value
            );


        if (!ids.length) {

          alert(
            "Select at least one project to invoice."
          );

          return;

        }


        selectedBillTo =
          (
            document.querySelector(
              "#tk_inv_billTo"
            ).value.trim()
          ) || "—";


        selectedInvoiceItems =
          tkProjects

            .filter(
              (p) =>
                ids.includes(
                  p.id
                )
            )

            .sort(
              (a, b) =>
                (a.serial || 0) -
                (b.serial || 0)
            );


        const invNum =
          tkSettings.nextInvoice ||
          "#INV-01";


        const totalPending =
          selectedInvoiceItems.reduce(
            (a, p) =>
              a +
              Math.max(
                0,
                Number(
                  p.amount || 0
                ) -
                Number(
                  p.received || 0
                )
              ),
            0
          );


        const bankIds =
          [
            ...new Set(
              selectedInvoiceItems

                .map(
                  (p) =>
                    p.bankId
                )

                .filter(Boolean)
            )
          ];


        const bank =
          (
            tkSettings.banks ||
            []
          ).find(
            (b) =>
              b.id ===
              bankIds[0]
          ) ||
          (
            tkSettings.banks ||
            []
          )[0];


        const termsList =
          (
            tkSettings.terms ||
            ""
          )

            .split("\n")

            .map(
              (t) =>
                t.trim()
            )

            .filter(Boolean);


        const rows =
          selectedInvoiceItems

            .map(
              (p) => {

                const price =
                  Math.max(
                    0,
                    Number(
                      p.amount ||
                      0
                    ) -
                    Number(
                      p.received ||
                      0
                    )
                  );


                const qty =
                  p.type === "video"

                    ? esc(
                        p.duration ||
                        "—"
                      )

                    : (
                        p.slides ||
                        0
                      ) +
                      " slides";


                return `

                  <tr>

                    <td>
                      ${esc(
                        p.title
                      )}
                    </td>

                    <td>
                      ${p.date ||
                        "—"}
                    </td>

                    <td>
                      ${qty}
                    </td>

                    <td>
                      ${fmt(
                        price
                      )}
                    </td>

                  </tr>

                `;

              }
            )

            .join("");


        const printArea =
          document.querySelector(
            "#tk-print-area"
          );


        if (!printArea) {
          return;
        }


        printArea.innerHTML = `

          <div
            class="tk-inv-head"
          >

            <div
              class="tk-inv-head-left"
            >

              ${
                tkSettings.logo

                  ? `
                    <img
                      src="${tkSettings.logo}"
                      alt="Logo"
                    >
                  `

                  : ""
              }

              <div>

                <div
                  class="tk-biz-name"
                >
                  ${esc(
                    (
                      tkSettings.companyName ||
                      "Your Company"
                    ).toUpperCase()
                  )}
                </div>

                ${
                  tkSettings.companyTagline

                    ? `

                      <div
                        class="tk-biz-tagline"
                      >
                        ${esc(
                          tkSettings.companyTagline
                        )}
                      </div>

                    `

                    : ""
                }

              </div>

            </div>


            <div
              class="tk-inv-head-right"
            >

              <div
                class="tk-inv-label"
              >
                INVOICE
              </div>

              <div
                class="tk-inv-num"
              >
                ${esc(
                  invNum
                )}
              </div>

            </div>

          </div>


          <hr
            class="tk-inv-rule"
          >


          <div
            class="tk-inv-2col"
          >

            <div>

              <h4>
                Bill To:
              </h4>

              <div
                class="tk-val"
              >
                ${esc(
                  selectedBillTo
                )}
              </div>

            </div>


            <div
              style="text-align:right;"
            >

              <h4>
                Invoice date
              </h4>

              <div
                class="tk-val"
              >
                ${
                  new Date()
                    .toLocaleDateString(
                      "en-GB"
                    )
                }
              </div>


              <h4
                style="
                  margin-top:12px;
                "
              >
                Payment information
              </h4>


              <div
                class="tk-inv-pay"
              >

                ${
                  bank

                    ? `

                      <div>
                        <b>Bank Name:</b>
                        ${esc(
                          bank.label
                        )}
                      </div>

                      <div>
                        <b>IFSC Code:</b>
                        ${esc(
                          bank.ifsc
                        )}
                      </div>

                      <div>
                        <b>Account Number:</b>
                        ${esc(
                          bank.accNo
                        )}
                      </div>

                      <div>
                        <b>UPI ID:</b>
                        ${esc(
                          bank.upi
                        )}
                      </div>

                    `

                    : `
                      Add a bank account
                      in Settings.
                    `
                }

              </div>

            </div>

          </div>


          <div
            class="tk-inv-contact"
          >

            <h4>
              Contact information
            </h4>

            <div>
              Email:
              ${esc(
                tkSettings.companyEmail ||
                "—"
              )}
            </div>

            <div>
              Phone:
              ${esc(
                tkSettings.companyPhone ||
                "—"
              )}
            </div>

          </div>


          <table
            class="tk-inv-table"
          >

            <thead>

              <tr>

                <th>
                  Type of service
                </th>

                <th>
                  Date submitted
                </th>

                <th>
                  Length/Quantity
                </th>

                <th>
                  Price
                </th>

              </tr>

            </thead>

            <tbody>
              ${rows}
            </tbody>

          </table>


          <div
            class="tk-inv-totals"
          >

            <div>

              <span>
                Subtotal:
              </span>

              <span>
                ${fmt(
                  totalPending
                )}
              </span>

            </div>


            <div
              class="tk-grand"
            >

              <span>
                Total Amount Due:
              </span>

              <span>
                ${fmt(
                  totalPending
                )}
              </span>

            </div>

          </div>


          <div
            class="tk-inv-bottom"
          >

            <div
              class="tk-inv-terms"
            >

              <h4>
                Terms and Conditions
              </h4>

              ${
                termsList.length

                  ? `

                    <ul>

                      ${
                        termsList
                          .map(
                            (t) =>
                              `
                                <li>
                                  ${esc(t)}
                                </li>
                              `
                          )
                          .join("")
                      }

                    </ul>

                  `

                  : ""
              }

            </div>


            ${
              tkSettings.seal

                ? `

                  <img
                    class="tk-inv-seal"
                    src="${tkSettings.seal}"
                    alt="Seal"
                  >

                `

                : ""
            }

          </div>


          <div
            class="tk-inv-footer"
          >

            <span>
              ${esc(
                tkSettings.companyEmail ||
                ""
              )}
            </span>

            <span>
              Ph. no -
              ${esc(
                tkSettings.companyPhone ||
                ""
              )}
            </span>

          </div>

        `;


        if (invoiceSelectModal) {

          invoiceSelectModal.classList.remove(
            "open"
          );

        }


        if (invoicePreviewModal) {

          invoicePreviewModal.classList.add(
            "open"
          );

        }

      }
    );

  }


  // ==========================================================
  // CLOSE INVOICE PREVIEW
  // ==========================================================

  const invoiceCloseBtn =
    document.querySelector(
      "#tk-invoice-close-btn"
    );


  if (invoiceCloseBtn) {

    invoiceCloseBtn.addEventListener(
      "click",
      () => {

        if (invoicePreviewModal) {

          invoicePreviewModal.classList.remove(
            "open"
          );

        }

      }
    );

  }


  if (invoicePreviewModal) {

    invoicePreviewModal.addEventListener(
      "click",
      (e) => {

        if (
          e.target ===
          invoicePreviewModal
        ) {

          invoicePreviewModal.classList.remove(
            "open"
          );

        }

      }
    );

  }


  // ==========================================================
  // PRINT
  // ==========================================================

  const printBtn =
    document.querySelector(
      "#tk-print-btn"
    );


  if (printBtn) {

    printBtn.addEventListener(
      "click",
      () => {

        window.print();

      }
    );

  }


  // ==========================================================
  // DOWNLOAD PDF
  // ==========================================================

  const downloadPdfBtn =
    document.querySelector(
      "#tk-download-pdf-btn"
    );


  if (downloadPdfBtn) {

    downloadPdfBtn.addEventListener(
      "click",
      () => {

        const element =
          document.querySelector(
            "#tk-print-area"
          );


        if (
          typeof window.html2pdf !==
          "function"
        ) {

          alert(
            "PDF library is not loaded. Refresh the page and try again."
          );

          return;
        }


        const invoiceNumber =
          (
            tkSettings.nextInvoice ||
            "invoice"
          )
            .replace(
              /[^a-z0-9-]/gi,
              ""
            );


        window
          .html2pdf()
          .set({

            margin: 0,

            filename:
              invoiceNumber +
              ".pdf",

            html2canvas: {
              scale: 2,
              useCORS: true
            },

            jsPDF: {
              unit: "pt",
              format: "a4",
              orientation: "portrait"
            }

          })
          .from(element)
          .save();

      }
    );

  }


  // ==========================================================
  // SAVE INVOICE
  // ==========================================================

  const confirmInvoiceBtn =
    document.querySelector(
      "#tk-confirm-invoice-btn"
    );


  if (confirmInvoiceBtn) {

    confirmInvoiceBtn.addEventListener(
      "click",
      async () => {

        if (
          !selectedInvoiceItems.length
        ) {

          return;

        }


        const invNum =
          tkSettings.nextInvoice ||
          "INV-001";


        const totalAmount =
          selectedInvoiceItems.reduce(
            (a, p) =>
              a +
              Number(
                p.amount || 0
              ),
            0
          );


        const totalPending =
          selectedInvoiceItems.reduce(
            (a, p) =>
              a +
              Math.max(
                0,
                Number(
                  p.amount || 0
                ) -
                Number(
                  p.received || 0
                )
              ),
            0
          );


        try {

          await addDoc(

            collection(
              db,
              TRACKER_INVOICES_COLLECTION
            ),

            {

              number:
                invNum,

              client:
                selectedBillTo,

              date:
                new Date()
                  .toISOString()
                  .slice(
                    0,
                    10
                  ),

              items:
                selectedInvoiceItems.map(
                  (p) => ({

                    title:
                      p.title,

                    amount:
                      p.amount

                  })
                ),

              total:
                totalAmount,

              pending:
                totalPending,

              createdAt:
                serverTimestamp()

            }

          );


          await setDoc(

            doc(
              db,
              ...TRACKER_SETTINGS_DOC
            ),

            {

              nextInvoice:
                bumpInvoiceNumber(
                  invNum
                )

            },

            {
              merge: true
            }

          );


          if (invoicePreviewModal) {

            invoicePreviewModal.classList.remove(
              "open"
            );

          }


          alert(
            "Invoice " +
            invNum +
            " saved with " +
            selectedInvoiceItems.length +
            " project(s)."
          );


        } catch (err) {

          console.error(
            "Invoice save error:",
            err
          );


          alert(
            err.message ||
            "Could not save the invoice — please try again."
          );

        }

      }
    );

  }

}


// ============================================================
// START TRACKER UI
// ============================================================

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    bootTrackerUI,
    {
      once: true
    }
  );

} else {

  bootTrackerUI();

}


// ============================================================
// START FIRESTORE AFTER LOGIN
// ============================================================

onAuthStateChanged(
  auth,
  (user) => {

    if (user) {

      startTrackerData();

    }

  }
);
