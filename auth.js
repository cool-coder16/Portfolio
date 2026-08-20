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
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js";

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
  measurementId: "G-NHNDXKVCJT",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Google Analytics (via Firebase) — once initialized, it automatically
// logs page views with no further calls needed. Not assigned to anything
// used elsewhere in this file, but getAnalytics(app) itself is what turns
// tracking on, so it still has to run.
getAnalytics(app);

let currentUser = null;
const authChangeListeners = [];
const GUEST_FLAG_KEY = "portfolioContinueAsGuest";

async function signUp(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}

async function logIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// Firebase's raw error messages (e.g. "Firebase: Error (auth/wrong-password).")
// are meant for developers, not the person typing in the modal. This maps
// the error codes we're actually likely to see to plain English; anything
// not listed here falls back to a generic message rather than showing the
// raw Firebase text.
const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/missing-email": "Enter your email above first, then click Forgot password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with that email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/missing-password": "Please enter a password.",
  "auth/too-many-requests": "Too many attempts — please wait a bit and try again.",
  "auth/network-request-failed": "Network error — check your connection and try again.",
};

function friendlyAuthError(err) {
  return AUTH_ERROR_MESSAGES[err.code] || "Something went wrong. Please try again.";
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

// Firebase Storage (for holding the actual uploaded file) now needs the
// paid Blaze plan even for tiny amounts of usage, so instead of uploading
// anywhere, this shrinks the picture down in the browser and saves it
// directly as a compressed, base64-encoded data URL — a plain text string
// — right on the user's Firestore document, the same free document every
// other saved field (username, etc.) already lives on. Firestore caps a
// document at 1MB total, which is why resizing it down first matters: a
// full-size photo would blow way past that, but a small compressed JPEG
// comfortably fits with room to spare.
async function uploadProfilePicture(file) {
  if (!currentUser) return null;
  const photoURL = await shrinkImageToDataURL(file);
  await saveUserData({ photoURL });
  return photoURL;
}

// Loads the file into an <img>, draws it onto a small canvas (scaled down,
// keeping its aspect ratio), and reads that back out as a compressed JPEG
// data URL. The avatar itself only ever displays at 96px, so 128px source
// is already more detail than it needs.
function shrinkImageToDataURL(file, maxSize = 128, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image file."));
    };
    img.src = objectUrl;
  });
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

  const forgotButton = document.createElement("button");
  forgotButton.type = "button";
  forgotButton.className = "auth-forgot-link";
  forgotButton.textContent = "Forgot password?";

  const buttonRow = document.createElement("div");
  buttonRow.className = "auth-buttons";
  const loginButton = document.createElement("button");
  loginButton.className = "btn";
  loginButton.textContent = "Log In";
  const signupButton = document.createElement("button");
  signupButton.className = "btn";
  signupButton.textContent = "Sign Up";
  buttonRow.append(loginButton, signupButton);

  const message = document.createElement("p");
  message.className = "auth-error";

  const guestButton = document.createElement("button");
  guestButton.className = "auth-guest-link";
  guestButton.textContent = "Continue without logging in";

  modal.append(
    heading,
    hint,
    emailInput,
    passwordInput,
    forgotButton,
    buttonRow,
    message,
    guestButton,
  );
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Shared by every button below so a click can't be double-submitted (both
  // buttons disable together) and so whichever one was clicked shows
  // "Please wait…" while its Firebase request is in flight — without this,
  // a slow connection just looks like the click did nothing.
  async function runAuthAction(button, action) {
    message.classList.remove("auth-success");
    message.textContent = "";
    const originalText = button.textContent;
    loginButton.disabled = true;
    signupButton.disabled = true;
    forgotButton.disabled = true;
    button.textContent = "Please wait…";
    try {
      await action();
    } catch (err) {
      message.textContent = friendlyAuthError(err);
    } finally {
      loginButton.disabled = false;
      signupButton.disabled = false;
      forgotButton.disabled = false;
      button.textContent = originalText;
    }
  }

  loginButton.addEventListener("click", () =>
    runAuthAction(loginButton, () => logIn(emailInput.value, passwordInput.value)),
  );

  signupButton.addEventListener("click", () =>
    runAuthAction(signupButton, () => signUp(emailInput.value, passwordInput.value)),
  );

  forgotButton.addEventListener("click", () =>
    runAuthAction(forgotButton, async () => {
      if (!emailInput.value) {
        throw { code: "auth/missing-email" };
      }
      await resetPassword(emailInput.value);
      message.classList.add("auth-success");
      message.textContent = "Password reset email sent — check your inbox.";
    }),
  );

  guestButton.addEventListener("click", () => {
    localStorage.setItem(GUEST_FLAG_KEY, "true");
    overlay.classList.add("auth-hidden");
  });

  return overlay;
}

const authModalOverlay = buildAuthModal();

// --- Navbar button ---
// Every page's navbar has one of these next to the theme toggle — shows
// "Login" when signed out or the account's name when signed in. Either
// way, clicking it just goes to the Accounts page (accounts.html), which
// has its own Log In button and — once signed in — a Log Out button. This
// is simpler than the button doing different things (open a modal vs. log
// out) depending on state, and matches the usual "click your name to see
// your profile" pattern. Guarded with a null check in case some future
// page's nav doesn't include the button.
function setupNavButton() {
  const button = document.getElementById("authNavButton");
  if (!button) return null;

  button.addEventListener("click", () => {
    window.location.href = "accounts.html";
  });

  return button;
}

const authNavButton = setupNavButton();

// Fires once immediately on page load with whatever session Firebase
// finds persisted in this browser (or null), and again any time
// sign-up/log-in/log-out happens — the single source of truth other
// scripts react to via onAuthChange() below, rather than each one having
// to duplicate this listener. Also the one place deciding whether the
// sign-in modal should be showing and what the navbar button reads.
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  for (const listener of authChangeListeners) listener(user);

  const isGuest = localStorage.getItem(GUEST_FLAG_KEY) === "true";
  authModalOverlay.classList.toggle("auth-hidden", Boolean(user) || isGuest);

  if (authNavButton) {
    if (user) {
      // Prefer the username saved on the Accounts page; Firebase
      // email/password auth has no separate username field of its own,
      // so until one's been set, the part of the email before @ stands
      // in for it — showing the full address in a small nav button reads
      // as cluttered.
      const data = await getUserData();
      authNavButton.textContent = data?.username || user.email.split("@")[0];
    } else {
      authNavButton.textContent = "Login";
    }
  }
});

window.PortfolioAuth = {
  signUp,
  logIn,
  logOut,
  getCurrentUser: () => currentUser,
  getUserData,
  saveUserData,
  uploadProfilePicture,
  // Registers a callback that runs immediately with the current user (or
  // null), then again on every future sign-up/log-in/log-out.
  onAuthChange: (callback) => {
    authChangeListeners.push(callback);
    callback(currentUser);
  },
};

window.dispatchEvent(new Event("portfolio-auth-ready"));
