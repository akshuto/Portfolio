// Mobile nav toggle
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

// Note: project filtering now lives in site-data.js since cards are loaded
// live from Firebase.

// Copy email to clipboard (contact.html)
const copyBtn = document.querySelector("[data-copy-email]");
if (copyBtn) {
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const email = copyBtn.dataset.copyEmail;
    navigator.clipboard.writeText(email).then(() => {
      const hint = document.querySelector(".copy-hint");
      if (hint) {
        hint.textContent = "Copied " + email + " to your clipboard.";
        setTimeout(() => (hint.textContent = ""), 3000);
      }
    });
  });
}

// Contact form -> opens the user's email client with the message pre-filled.
// There's no backend here, so this is the simplest zero-cost way to receive messages.
const contactForm = document.querySelector("#contact-form");
if (contactForm) {
  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = contactForm.name.value.trim();
    const message = contactForm.message.value.trim();
    const subject = encodeURIComponent("Portfolio inquiry from " + (name || "your site"));
    const body = encodeURIComponent(message + "\n\n— " + name);
    window.location.href = `mailto:akshaytu45@gmail.com?subject=${subject}&body=${body}`;
  });
}
