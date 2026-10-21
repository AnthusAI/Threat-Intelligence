// Theme switch (System, Light, Dark). The choice is stored in localStorage; the head script in hooks.py applies it before first paint.
(function () {
  var KEY = "anthus-threat-intelligence-theme";
  var buttons = document.querySelectorAll("[data-theme-choice]");
  function current() {
    var value = document.documentElement.getAttribute("data-theme");
    return value === "light" || value === "dark" ? value : "system";
  }
  function sync() {
    var value = current();
    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-theme-choice") === value));
    });
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      var value = button.getAttribute("data-theme-choice");
      try { window.localStorage.setItem(KEY, value); } catch (error) {}
      document.documentElement.setAttribute("data-theme", value);
      sync();
    });
  });
  window.addEventListener("storage", function () {
    try {
      var stored = window.localStorage.getItem(KEY);
      if (stored === "system" || stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
    } catch (error) {}
    sync();
  });
  sync();
})();
