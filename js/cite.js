/* The paper's citation in BibTeX, for the "Download citation (BibTeX)" button of the page (in the reference right
   below the title), as on the group's brane tiling pages (branetilings/brane-tilings/app.js).  The entry is the one
   the user gave, key and all (2026-11-23: "the bibtex citation in xai webpages should all be the following exact text
   with exact same id"), INSPIRE's Lee:2026avt.  The page makes the file itself, so the button works from disk too. */
(function () {
  'use strict';

  var BIBTEX = '@article{Lee:2026avt,\n' +
    '    author = "Lee, Seong-Jin and Seong, Rak-Kyeong",\n' +
    '    title = "{Diagnosing Inconsistencies in 4d N=1 Gauge Theories with Explainable AI}",\n' +
    '    eprint = "2609.21867",\n' +
    '    archivePrefix = "arXiv",\n' +
    '    primaryClass = "hep-th",\n' +
    '    reportNumber = "UNIST-MTH-26-RS-06, CGP26020",\n' +
    '    month = "9",\n' +
    '    year = "2026"\n' +
    '}\n';
  var FILE = 'diagnosing_inconsistencies_in_4d_n1_gauge_theories_with_explainable_ai.bib';
  var TITLE = 'BibTeX entry of the paper (arXiv:2609.21867)';

  /* a file made in the page and saved by the browser: a link to a file would open it instead when the page is
     opened from disk */
  function saveCitation() {
    var url = URL.createObjectURL(new Blob([BIBTEX], { type: 'application/x-bibtex' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = FILE;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.bt-cite[data-static]'), function (b) {
    b.title = TITLE;
    b.addEventListener('click', saveCitation);
  });
})();
