(() => {
  try {
    const storedTheme = window.localStorage.getItem("bgcut-theme");

    if (storedTheme === "light" || storedTheme === "dark") {
      document.documentElement.dataset.theme = storedTheme;
    }
  } catch {
    // The default light theme remains active when storage is unavailable.
  }
})();
