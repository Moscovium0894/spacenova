// Amplitude Analytics — loaded on every page
(function () {
  var script = document.createElement('script');
  script.src = 'https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz';
  script.onload = function () {
    window.amplitude.init('f0c226ac70c239db75e483dbcb0c72ec', {
      autocapture: {
        attribution: true,
        fileDownloads: true,
        formInteractions: true,
        pageViews: true,
        sessions: true,
        elementInteractions: true
      }
    });
  };
  document.head.appendChild(script);
})();
