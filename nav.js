// Lightweight theme toggle shared by the Home and Projects pages. The maze
// app (script.js) has its own fuller version of this same idea, since it
// also has to re-color the canvas and the color pickers — pages that don't
// load the maze app only ever need to flip a CSS class.
const themeToggleButton = document.getElementById("themeToggle");

function applyTheme(lightMode) {
  document.documentElement.classList.toggle("light-theme", lightMode);
  themeToggleButton.textContent = lightMode ? "Dark Mode" : "Light Mode";
}

themeToggleButton.addEventListener("click", () => {
  const isLight = document.documentElement.classList.contains("light-theme");
  applyTheme(!isLight);
});

// Default to whatever the user's OS/browser is already set to — same
// reasoning as script.js's version: read once at load, don't fight a
// manual toggle if the system setting changes later.
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
applyTheme(prefersLight);

// On single-sidebar pages (PIDF Panel, IK Calculator, NN Classifier), an
// invisible spacer sits on the other side of main, matching the sidebar's
// width exactly — that's what keeps the canvas itself centered on the
// page instead of the sidebar+canvas pair being centered as a block (which
// would leave the canvas sitting left of true center, shifted by roughly
// half the sidebar's width). No-op on pages that don't have both
// elements. Measured in JS rather than hardcoded since the sidebar's
// natural width isn't a fixed value — it depends on its actual contents.
function syncSidebarSpacer() {
  const sidebar = document.querySelector(".page.single-sidebar .controls-panel");
  const spacer = document.querySelector(".page.single-sidebar .sidebar-spacer");
  if (!sidebar || !spacer) return;
  spacer.style.width = `${sidebar.getBoundingClientRect().width}px`;
}

syncSidebarSpacer();
window.addEventListener("resize", syncSidebarSpacer);
