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
