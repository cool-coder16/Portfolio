// Single shared list of portfolio projects, loaded on every page. Add a
// new project here and it automatically shows up both in the Projects
// page grid and the navbar's Projects dropdown — nothing else to update.
const PROJECTS = [
  {
    name: "Maze Robot Simulator",
    url: "maze-robot.html",
    description:
      "A 2D robot that solves mazes it's never seen, using either a hand-written right-hand-rule wall follower or a real step-by-step A* search. Draw your own maze or generate a random one, watch it solve live, and customize every color.",
  },
  {
    name: "PIDF Panel",
    url: "pidf-panel.html",
    description:
      "A live PIDF controller tuner: adjustable P, I, D, and feedforward (F) gains with a real-time graph of how the system responds. Includes tooltips explaining each term and an Auto-Tune button that searches for good gains automatically.",
  },
  {
    name: "Inverse Kinematics Calculator",
    url: "ik-calculator.html",
    description:
      "A robot arm chain that solves its own joint angles to reach a target point, using Cyclic Coordinate Descent with self-collision detection so it can't pass through itself. Set the number of arms, each arm's length, and drag the target — Step or Solve to watch it reach.",
  },
  {
    name: "Tiny Neural Network Classifier",
    url: "nn-classifier.html",
    description:
      "A small hand-written neural network that learns to separate two classes of points, with the decision boundary shading live as it trains via real backpropagation. Click to place points or load a preset (including XOR, which no straight line can separate) and watch it learn.",
  },
  {
    name: "Rainbow Sort Visualizer",
    url: "sorting-visualizer.html",
    description:
      "Bars colored across the rainbow, shuffled out of order, sorted back into place by a hand-written Bubble Sort or Merge Sort. Step through one pass at a time or watch it run, and compare how many passes each algorithm actually takes. Work in progress.",
  },
];

// Fills in the navbar's Projects dropdown, if this page has one.
function renderNavProjectsDropdown() {
  const menu = document.getElementById("navProjectsDropdown");
  if (!menu) return;

  for (const project of PROJECTS) {
    const link = document.createElement("a");
    link.href = project.url;
    link.className = "dropdown-item";
    link.textContent = project.name;
    menu.appendChild(link);
  }
}

// Fills in the Projects page's card grid, if this page has one.
function renderProjectGrid() {
  const grid = document.getElementById("projectGrid");
  if (!grid) return;

  for (const project of PROJECTS) {
    const card = document.createElement("a");
    card.href = project.url;
    card.className = "project-card";

    const heading = document.createElement("h2");
    heading.textContent = project.name;

    const description = document.createElement("p");
    description.textContent = project.description;

    card.appendChild(heading);
    card.appendChild(description);
    grid.appendChild(card);
  }
}

renderNavProjectsDropdown();
renderProjectGrid();
