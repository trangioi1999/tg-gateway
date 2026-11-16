// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
// Choices: "light" (default), "dark", "system". Stored per browser only.
(function () {
  var choice = "light";
  try {
    choice = localStorage.getItem("tg-theme") || "light";
  } catch (e) {}
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function apply(value) {
    var dark = value === "dark" || (value === "system" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themeChoice = value;
  }
  apply(choice);
  media.addEventListener("change", function () {
    apply(document.documentElement.dataset.themeChoice || "light");
  });
  window.tgSetTheme = function (value) {
    try {
      localStorage.setItem("tg-theme", value);
    } catch (e) {}
    apply(value);
  };
})();
