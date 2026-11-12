// Runs before first paint: turns on the animated layout only for visitors who haven't asked for reduced motion
// and who aren't on Data Saver. home.js removes the flag again if GSAP fails to load.
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveData = navigator.connection && navigator.connection.saveData;
  if (!reduce && !saveData) document.documentElement.classList.add('motion');
})();
