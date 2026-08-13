// --- Shared account system ---
// Wraps Firebase Auth (email/password) + Firestore so any page on the
// site can offer "the same account" experience — sign in once, and
// whatever a project saves to your account follows you, instead of being
// stuck in one browser's localStorage.
//
// This file is loaded as an ES module (<script type="module">), which
// runs AFTER the page's regular classic scripts (like raycasting-doom.js)
// have already executed — so those scripts can't just call functions
// from here directly at load time. Instead, everything gets attached to
// window.PortfolioAuth, and a "portfolio-auth-ready" event fires once
// it's safe to use — see the bottom of this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// This config is meant to be public — it identifies which Firebase
// project to talk to, not a secret. The actual protection is the
// Firestore security rules (each user can only read/write their OWN
// document, enforced server-side), not keeping this hidden.
const firebaseConfig = {
  apiKey: "AIzaSyCsDul2pK8Ctv1V9jb45Ktj9d4DZsakzKE",
  authDomain: "portfolio-f4bb7.firebaseapp.com",
  projectId: "portfolio-f4bb7",
  storageBucket: "portfolio-f4bb7.firebasestorage.app",
  messagingSenderId: "1030427566587",
  appId: "1:1030427566587:web:5658699f65c7bb7585eb5e",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
const authChangeListeners = [];
const GUEST_FLAG_KEY = "portfolioContinueAsGuest";

async function signUp(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}

async function logIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

// Clears the "continue without logging in" choice too — an intentional
// log-out reads as "I might want to sign into something," so the modal
// should offer that again on the next page, rather than staying silently
// dismissed forever just because it was dismissed once, possibly a while
// ago under a different account.
async function logOut() {
  await signOut(auth);
  localStorage.removeItem(GUEST_FLAG_KEY);
}

// Reads the signed-in user's saved data — one document per user, keyed
// by their Firebase-assigned UID (not their email, which they could
// change), under a top-level "users" collection.
async function getUserData() {
  if (!currentUser) return null;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  return snap.exists() ? snap.data() : {};
}

// Merges the given fields into the user's document instead of
// overwriting it, so e.g. saving raycastingBestFloor doesn't clobber
// fields a different project might save later.
async function saveUserData(partialData) {
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid), partialData, { merge: true });
}

// --- Sign-in modal ---
// Built entirely here in JS, instead of hand-written HTML repeated in
// every page, so adding this to another page is just the one <script
// type="module" src="auth.js"> tag — no markup to keep in sync across a
// dozen HTML files.
function buildAuthModal() {
  const overlay = document.createElement("div");
  overlay.className = "auth-modal-overlay auth-hidden";

  const modal = document.createElement("div");
  modal.className = "auth-modal";

  const heading = document.createElement("h2");
  heading.textContent = "Sign in to save your progress";

  const hint = document.createElement("p");
  hint.className = "auth-modal-hint";
  hint.textContent =
    "Projects like Raycasting Mini-Doom save things — like your best floor — to your account, so they follow you anywhere instead of staying stuck in just this browser.";

  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.className = "auth-input";
  emailInput.placeholder = "Email";
  emailInput.autocomplete = "email";

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.className = "auth-input";
  passwordInput.placeholder = "Password";
  passwordInput.autocomplete = "current-password";

  const buttonRow = document.createElement("div");
  buttonRow.className = "auth-buttons";
  const loginButton = document.createElement("button");
  loginButton.className = "btn";
  loginButton.textContent = "Log In";
  const signupButton = document.createElement("button");
  signupButton.className = "btn";
  signupButton.textContent = "Sign Up";
  buttonRow.append(loginButton, signupButton);

  const error = document.createElement("p");
  error.className = "auth-error";

  const guestButton = document.createElement("button");
  guestButton.className = "auth-guest-link";
  guestButton.textContent = "Continue without logging in";

  modal.append(
    heading,
    hint,
    emailInput,
    passwordInput,
    buttonRow,
    error,
    guestButton,
  );
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  loginButton.addEventListener("click", async () => {
    error.textContent = "";
    try {
      await logIn(emailInput.value, passwordInput.value);
    } catch (err) {
      error.textContent = err.message;
    }
  });

  signupButton.addEventListener("click", async () => {
    error.textContent = "";
    try {
      await signUp(emailInput.value, passwordInput.value);
    } catch (err) {
      error.textContent = err.message;
    }
  });

  guestButton.addEventListener("click", () => {
    localStorage.setItem(GUEST_FLAG_KEY, "true");
    overlay.classList.add("auth-hidden");
  });

  return overlay;
}

const authModalOverlay = buildAuthModal();

// --- Navbar button ---
// Every page's navbar has one of these next to the theme toggle — shows
// "Login" (opens the same modal Continue-without-login would otherwise
// dismiss) when signed out, or the account's name when signed in
// (clicking it then logs out, the common "click your name to leave"
// pattern). Guarded with a null check in case some future page's nav
// doesn't include the button.
function setupNavButton(overlay) {
  const button = document.getElementById("authNavButton");
  if (!button) return null;

  button.addEventListener("click", () => {
    if (currentUser) logOut();
    else overlay.classList.remove("auth-hidden");
  });

  return button;
}

const authNavButton = setupNavButton(authModalOverlay);

// Fires once immediately on page load with whatever session Firebase
// finds persisted in this browser (or null), and again any time
// sign-up/log-in/log-out happens — the single source of truth other
// scripts react to via onAuthChange() below, rather than each one having
// to duplicate this listener. Also the one place deciding whether the
// sign-in modal should be showing and what the navbar button reads.
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  for (const listener of authChangeListeners) listener(user);

  const isGuest = localStorage.getItem(GUEST_FLAG_KEY) === "true";
  authModalOverlay.classList.toggle("auth-hidden", Boolean(user) || isGuest);

  if (authNavButton) {
    // Firebase email/password auth has no separate "username" field —
    // the part of the email before @ stands in for one, since showing
    // the full address in a small nav button reads as cluttered.
    authNavButton.textContent = user ? user.email.split("@")[0] : "Login";
  }
});

window.PortfolioAuth = {
  signUp,
  logIn,
  logOut,
  getCurrentUser: () => currentUser,
  getUserData,
  saveUserData,
  // Registers a callback that runs immediately with the current user (or
  // null), then again on every future sign-up/log-in/log-out.
  onAuthChange: (callback) => {
    authChangeListeners.push(callback);
    callback(currentUser);
  },
};

window.dispatchEvent(new Event("portfolio-auth-ready"));
