# PDF.js [![CI](https://github.com/mozilla/pdf.js/actions/workflows/ci.yml/badge.svg?query=branch%3Amaster)](https://github.com/mozilla/pdf.js/actions/workflows/ci.yml?query=branch%3Amaster) [![codecov](https://codecov.io/gh/mozilla/pdf.js/branch/master/graph/badge.svg)](https://codecov.io/gh/mozilla/pdf.js)

[PDF.js](https://mozilla.github.io/pdf.js/) is a Portable Document Format (PDF) viewer that is built with HTML5.

PDF.js is community-driven and supported by Mozilla. This repository is a customized 
version of the original PDF.js, adapted for integration with Cluing, our collaborative
writing app, with a primary focus on supporting the highlight feature in our PDF editor. The 
version of PDF.js used at the time of modification was 6.1.200. For each change made,
I left comments to facilitate easy updates to newer versions in the future 
(all comments begin with @Cluing to distinguish them from other comments).

## Building PDF.js

In order to build the pdfjs run:

    $ npx gulp dist

This will generate a build folder with a dist folder in it.

### Important!
 - Copy all content from /build/dist to 
app/src/packages/pdfjs-dist in the Cluing app project. 
 - Copy pdf.worker.min.mjs from /build/dist/legacy/build
to src/assets/pdfjs

## Using PDF.js in a Cluing application

You can use pdfjs using these imports

    import * as pdfjsLib from "pdfjs-dist";
    import * as pdfjsViewer from "pdfjs-dist/legacy/web/pdf_viewer";
    import "pdfjs-dist/web/pdf_viewer.css";
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs`;
