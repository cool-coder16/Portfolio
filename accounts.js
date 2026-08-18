// auth.js loads as an ES module, which runs AFTER this classic script has
// already finished executing — so window.PortfolioAuth doesn't exist yet
// at the top of this file. "portfolio-auth-ready" fires once it's safe
// to use (see the big comment at the top of auth.js for why).
window.addEventListener("portfolio-auth-ready", () => {
  const loggedOutPanel = document.getElementById("accountLoggedOut");
  const loggedInPanel = document.getElementById("accountLoggedIn");
  const avatar = document.getElementById("accountAvatar");
  const pictureInput = document.getElementById("accountPictureInput");
  const uploadStatus = document.getElementById("accountUploadStatus");
  const usernameInput = document.getElementById("accountUsernameInput");
  const saveUsernameButton = document.getElementById(
    "accountSaveUsernameButton",
  );
  const emailDisplay = document.getElementById("accountEmailDisplay");
  const loginButton = document.getElementById("accountLoginButton");

  // Tracked here (not just read off the DOM) so saving a new username
  // doesn't have to guess whether a picture is already set — without
  // this, re-rendering the avatar after a username-only save would have
  // no way to tell "no picture yet" apart from "there IS one, just don't
  // clear it."
  let photoURL = null;

  function renderAvatar() {
    if (photoURL) {
      avatar.style.backgroundImage = `url("${photoURL}")`;
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "none";
      const label = usernameInput.value || emailDisplay.textContent || "?";
      avatar.textContent = label[0].toUpperCase();
    }
  }

  window.PortfolioAuth.onAuthChange(async (user) => {
    if (!user) {
      loggedOutPanel.classList.remove("auth-hidden");
      loggedInPanel.classList.add("auth-hidden");
      return;
    }

    loggedOutPanel.classList.add("auth-hidden");
    loggedInPanel.classList.remove("auth-hidden");
    emailDisplay.textContent = user.email;

    const data = await window.PortfolioAuth.getUserData();
    usernameInput.value = data?.username || "";
    photoURL = data?.photoURL || null;
    renderAvatar();
  });

  loginButton.addEventListener("click", () => {
    document
      .querySelector(".auth-modal-overlay")
      .classList.remove("auth-hidden");
  });

  pictureInput.addEventListener("change", async () => {
    const file = pictureInput.files[0];
    if (!file) return;

    uploadStatus.textContent = "Uploading…";
    try {
      photoURL = await window.PortfolioAuth.uploadProfilePicture(file);
      renderAvatar();
      uploadStatus.textContent = "Updated!";
      setTimeout(() => {
        uploadStatus.textContent = "";
      }, 2000);
    } catch (err) {
      uploadStatus.textContent = err.message;
    }
  });

  saveUsernameButton.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) return;
    await window.PortfolioAuth.saveUserData({ username });
    renderAvatar(); // picks up the new username as the fallback-letter source, if no photo is set
  });
});
