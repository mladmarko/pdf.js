/* Copyright 2021 Mozilla Foundation
 * ... (keep the original license header)
 */

import { internalOpt } from "./internal_evt.js";

/** @typedef {import("./event_utils").EventBus} EventBus */
/** @typedef {import("./pdf_find_controller").PDFFindController} PDFFindController */

/**
 * @typedef {Object} TextHighlighterOptions
 * @property {PDFFindController} findController
 * @property {EventBus} eventBus
 * @property {number} pageIndex
 */

class TextHighlighter {
  #eventAC = null;

  /** @type {HTMLElement | null} */
  #overlay = null;

  constructor({ findController, eventBus, pageIndex }) {
    this.findController = findController;
    this.matches = [];
    this.eventBus = eventBus;
    this.pageIdx = pageIndex;
    this.textDivs = null;
    this.textContentItemsStr = null;
    this.enabled = false;
  }

  setTextMapping(divs, texts) {
    this.textDivs = divs;
    this.textContentItemsStr = texts;
  }

  enable() {
    if (!this.textDivs || !this.textContentItemsStr) {
      throw new Error("Text divs and strings have not been set.");
    }
    if (this.enabled) {
      throw new Error("TextHighlighter is already enabled.");
    }
    this.enabled = true;

    if (!this.#eventAC) {
      this.#eventAC = new AbortController();

      this.eventBus.on(
        "updatetextlayermatches",
        evt => {
          if (evt.pageIndex === this.pageIdx || evt.pageIndex === -1) {
            this._updateMatches();
          }
        },
        { signal: this.#eventAC.signal, ...internalOpt }
      );
    }
    this._updateMatches();
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;

    this.#eventAC?.abort();
    this.#eventAC = null;

    this._updateMatches(/* reset = */ true);
  }

  _convertMatches(matches, matchesLength) {
    if (!matches) {
      return [];
    }
    const { textContentItemsStr } = this;

    let i = 0,
      iIndex = 0;
    const end = textContentItemsStr.length - 1;
    const result = [];

    for (let m = 0, mm = matches.length; m < mm; m++) {
      let matchIdx = matches[m];

      while (i !== end && matchIdx >= iIndex + textContentItemsStr[i].length) {
        iIndex += textContentItemsStr[i].length;
        i++;
      }

      if (i === textContentItemsStr.length) {
        console.error("Could not find a matching mapping");
      }

      const match = {
        begin: {
          divIdx: i,
          offset: matchIdx - iIndex,
        },
      };

      matchIdx += matchesLength[m];

      while (i !== end && matchIdx > iIndex + textContentItemsStr[i].length) {
        iIndex += textContentItemsStr[i].length;
        i++;
      }

      match.end = {
        divIdx: i,
        offset: matchIdx - iIndex,
      };
      result.push(match);
    }
    return result;
  }

  /**
   * Ensures there is an overlay container inside the text layer.
   * We attach it to the parent of the first textDiv (the textLayer div).
   */
  #ensureOverlay() {
    if (this.#overlay && this.#overlay.isConnected) {
      return this.#overlay;
    }

    const firstDiv = this.textDivs?.[0];
    if (!firstDiv) return null;

    const textLayer = firstDiv.parentElement;
    if (!textLayer) return null;

    let overlay = textLayer.querySelector(".highlightOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "highlightOverlay";
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
      `;
      textLayer.append(overlay);
    }

    this.#overlay = overlay;
    return overlay;
  }

  /**
   * Creates highlight rectangles for a single match using Range + getClientRects.
   */
  #createHighlightRects(match, className) {
    const { textDivs } = this;
    const overlay = this.#ensureOverlay();
    if (!overlay) return null;

    const layerRect = overlay.getBoundingClientRect();
    const elements = [];

    const addRectsFromRange = (divIdx, startOffset, endOffset) => {
      const div = textDivs[divIdx];
      if (!div) return;

      // Find the text node inside the div
      let textNode = div;
      if (div.nodeType !== Node.TEXT_NODE) {
        textNode = div.firstChild;
        while (textNode && textNode.nodeType !== Node.TEXT_NODE) {
          textNode = textNode.nextSibling || textNode.firstChild;
        }
      }
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

      const range = document.createRange();
      try {
        const len = textNode.length;
        range.setStart(textNode, Math.min(startOffset, len));
        range.setEnd(textNode, Math.min(endOffset, len));
      } catch {
        return;
      }

      const rects = range.getClientRects();
      for (const rect of rects) {
        if (rect.width === 0 && rect.height === 0) continue;

        const el = document.createElement("div");
        el.className = `highlight-overlay ${className}`;
        el.style.cssText = `
          position: absolute;
          left: ${rect.left - layerRect.left}px;
          top: ${rect.top - layerRect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          pointer-events: none;
        `;
        overlay.append(el);
        elements.push(el);
      }
    };

    const { begin, end } = match;

    if (begin.divIdx === end.divIdx) {
      // Match is inside a single text div
      addRectsFromRange(begin.divIdx, begin.offset, end.offset);
    } else {
      // Multi-div match
      // 1. From begin.offset to the end of the first div
      addRectsFromRange(begin.divIdx, begin.offset, textContentItemsStr[begin.divIdx].length);

      // 2. Full middle divs
      for (let n = begin.divIdx + 1; n < end.divIdx; n++) {
        addRectsFromRange(n, 0, textContentItemsStr[n].length);
      }

      // 3. From start of last div to end.offset
      addRectsFromRange(end.divIdx, 0, end.offset);
    }

    return elements.length ? elements[0] : null; // return first element for scrolling
  }

  _renderMatches(matches) {
    if (matches.length === 0) {
      return;
    }

    const { findController, pageIdx } = this;
    const isSelectedPage = pageIdx === findController.selected.pageIdx;
    const selectedMatchIdx = findController.selected.matchIdx;
    const highlightAll = findController.state.highlightAll;

    let i0 = selectedMatchIdx;
    let i1 = i0 + 1;

    if (highlightAll) {
      i0 = 0;
      i1 = matches.length;
    } else if (!isSelectedPage) {
      return;
    }

    // Make sure overlay exists and is empty
    const overlay = this.#ensureOverlay();
    if (overlay) {
      overlay.replaceChildren();
    }

    let selectedElement = null;

    for (let i = i0; i < i1; i++) {
      const match = matches[i];
      const isSelected = isSelectedPage && i === selectedMatchIdx;
      const className = "highlight" + (isSelected ? " selected" : "");

      const firstEl = this.#createHighlightRects(match, className);

      if (isSelected && firstEl) {
        selectedElement = firstEl;
      }
    }

    // Scroll the selected match into view
    if (selectedElement) {
      findController.scrollMatchIntoView({
        element: selectedElement,
        pageIndex: pageIdx,
        matchIndex: selectedMatchIdx,
      });
    }
  }

  _updateMatches(reset = false) {
    if (!this.enabled && !reset) {
      return;
    }

    // Clear previous overlay highlights
    if (this.#overlay) {
      this.#overlay.replaceChildren();
    }

    if (!this.findController?.highlightMatches || reset) {
      this.matches = [];
      return;
    }

    const pageMatches = this.findController.pageMatches[this.pageIdx] || null;
    const pageMatchesLength = this.findController.pageMatchesLength[this.pageIdx] || null;

    this.matches = this._convertMatches(pageMatches, pageMatchesLength);
    this._renderMatches(this.matches);
  }
}

export { TextHighlighter };
