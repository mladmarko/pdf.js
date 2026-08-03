/* Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** @typedef {import("./event_utils").EventBus} EventBus */
/** @typedef {import("./pdf_find_controller").PDFFindController} PDFFindController */

/**
 * @typedef {Object} TextHighlighterOptions
 * @property {PDFFindController} findController
 * @property {EventBus} eventBus - The application event bus.
 * @property {number} pageIndex - The page index.
 */

/**
 * TextHighlighter handles highlighting matches from the FindController.
 * This version draws highlights as overlays instead of injecting <span>s,
 * so the text layer DOM stays clean for selection / snippet saving.
 */
class TextHighlighter {
  #eventAbortController = null;

  /** @type {HTMLElement | null} */
  #overlay = null;

  /**
   * @param {TextHighlighterOptions} options
   */
  constructor({ findController, eventBus, pageIndex }) {
    this.findController = findController;
    this.matches = [];
    this.eventBus = eventBus;
    this.pageIdx = pageIndex;
    this.textDivs = null;
    this.textContentItemsStr = null;
    this.enabled = false;
  }

  /**
   * @param {Array<Node>} divs
   * @param {Array<string>} texts
   */
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

    if (!this.#eventAbortController) {
      this.#eventAbortController = new AbortController();

      this.eventBus._on(
        "updatetextlayermatches",
        evt => {
          if (evt.pageIndex === this.pageIdx || evt.pageIndex === -1) {
            this._updateMatches();
          }
        },
        { signal: this.#eventAbortController.signal }
      );
    }
    this._updateMatches();
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;

    this.#eventAbortController?.abort();
    this.#eventAbortController = null;

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
   * Ensures an overlay container exists inside the text layer.
   */
  #ensureOverlay() {
    if (this.#overlay?.isConnected) {
      return this.#overlay;
    }

    const firstDiv = this.textDivs?.[0];
    if (!firstDiv) {
      return null;
    }

    const textLayer = firstDiv.parentElement;
    if (!textLayer) {
      return null;
    }

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
   * Finds the first text node inside a textDiv.
   */
  #findTextNode(el) {
    if (el.nodeType === Node.TEXT_NODE) {
      return el;
    }
    for (const child of el.childNodes) {
      const found = this.#findTextNode(child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * Creates overlay highlight rectangles for one match using Range + getClientRects.
   * Returns the first created element (useful for scrolling).
   */
  #createHighlightRects(match, className) {
    const { textDivs, textContentItemsStr } = this;
    const overlay = this.#ensureOverlay();
    if (!overlay) {
      return null;
    }

    const layerRect = overlay.getBoundingClientRect();
    const created = [];

    const addRects = (divIdx, startOffset, endOffset) => {
      const div = textDivs[divIdx];
      if (!div) {
        return;
      }

      const textNode = this.#findTextNode(div);
      if (!textNode) {
        return;
      }

      const range = document.createRange();
      try {
        const len = textNode.length;
        range.setStart(textNode, Math.min(Math.max(0, startOffset), len));
        range.setEnd(textNode, Math.min(Math.max(0, endOffset), len));
      } catch {
        return;
      }

      const rects = range.getClientRects();
      for (const rect of rects) {
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }

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
        created.push(el);
      }
    };

    const { begin, end } = match;

    if (begin.divIdx === end.divIdx) {
      // Single textDiv
      addRects(begin.divIdx, begin.offset, end.offset);
    } else {
      // Multi-div match
      addRects(
        begin.divIdx,
        begin.offset,
        textContentItemsStr[begin.divIdx].length
      );

      for (let n = begin.divIdx + 1; n < end.divIdx; n++) {
        addRects(n, 0, textContentItemsStr[n].length);
      }

      addRects(end.divIdx, 0, end.offset);
    }

    return created[0] || null;
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

    // Clear previous overlays
    const overlay = this.#ensureOverlay();
    if (overlay) {
      overlay.replaceChildren();
    }

    let selectedElement = null;
    let selectedLeft = 0;

    for (let i = i0; i < i1; i++) {
      const match = matches[i];
      const isSelected = isSelectedPage && i === selectedMatchIdx;
      const className = "highlight" + (isSelected ? " selected" : "");

      const firstEl = this.#createHighlightRects(match, className);

      if (isSelected && firstEl) {
        selectedElement = firstEl;

        // Approximate selectedLeft the same way the original code did
        // (relative to the textDiv)
        const div = this.textDivs[match.begin.divIdx];
        if (div) {
          const divRect = div.getBoundingClientRect();
          const elRect = firstEl.getBoundingClientRect();
          selectedLeft = elRect.left - divRect.left;
        }
      }
    }

    if (selectedElement) {
      findController.scrollMatchIntoView({
        element: this.textDivs[matches[selectedMatchIdx].begin.divIdx],
        selectedLeft,
        pageIndex: pageIdx,
        matchIndex: selectedMatchIdx,
      });
    }
  }

  _updateMatches(reset = false) {
    if (!this.enabled && !reset) {
      return;
    }

    // Clear overlay
    if (this.#overlay) {
      this.#overlay.replaceChildren();
    }

    // Note: we no longer touch textDivs.textContent or className

    if (!this.findController?.highlightMatches || reset) {
      this.matches = [];
      return;
    }

    const pageMatches = this.findController.pageMatches[this.pageIdx] || null;
    const pageMatchesLength =
      this.findController.pageMatchesLength[this.pageIdx] || null;

    this.matches = this._convertMatches(pageMatches, pageMatchesLength);
    this._renderMatches(this.matches);
  }
}

export { TextHighlighter };
