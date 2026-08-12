/**
 * nav.js
 * Device detection and mobile navigation toggle logic for Academia Augustiniana.
 */

function updateLayoutMode() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        document.body.classList.add("is-mobile");
        document.body.classList.remove("is-desktop");
        ensureHamburgerToggle();
    } else {
        document.body.classList.add("is-desktop");
        document.body.classList.remove("is-mobile");
        // Hide mobile menu active states if screen is resized to desktop
        const menuToggle = document.getElementById("menu-toggle");
        const navbar = document.querySelector(".navbar");
        const navLinks = navbar ? navbar.querySelector(".nav-links") : null;
        if (menuToggle) menuToggle.classList.remove("active");
        if (navLinks) navLinks.classList.remove("active");
        document.body.classList.remove("nav-open");
    }
}

function ensureHamburgerToggle() {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;

    let menuToggle = document.getElementById("menu-toggle");
    if (!menuToggle) {
        menuToggle = document.createElement("button");
        menuToggle.id = "menu-toggle";
        menuToggle.className = "menu-toggle";
        menuToggle.setAttribute("aria-label", "Toggle navigation");
        menuToggle.innerHTML = "<span></span><span></span><span></span>";

        const logo = navbar.querySelector(".logo");
        if (logo) {
            logo.after(menuToggle);
        } else {
            navbar.prepend(menuToggle);
        }

        // Attach listeners
        const navLinks = navbar.querySelector(".nav-links");
        if (navLinks) {
            menuToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                menuToggle.classList.toggle("active");
                navLinks.classList.toggle("active");
                document.body.classList.toggle("nav-open");
            });

            // Close when link clicked
            navLinks.querySelectorAll("a").forEach(link => {
                link.addEventListener("click", () => {
                    menuToggle.classList.remove("active");
                    navLinks.classList.remove("active");
                    document.body.classList.remove("nav-open");
                });
            });
        }
    }
}

// Close mobile menu when clicking outside navbar
document.addEventListener("click", (e) => {
    const navbar = document.querySelector(".navbar");
    if (navbar && !navbar.contains(e.target)) {
        const menuToggle = document.getElementById("menu-toggle");
        const navLinks = navbar.querySelector(".nav-links");
        if (menuToggle && menuToggle.classList.contains("active")) {
            menuToggle.classList.remove("active");
            if (navLinks) navLinks.classList.remove("active");
            document.body.classList.remove("nav-open");
        }
    }
});

// Run detection on load and resize
window.addEventListener("resize", updateLayoutMode);
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateLayoutMode);
} else {
    updateLayoutMode();
}
