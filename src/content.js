(function installGwangjuFilterContent(globalScope) {
  "use strict";

  const INSTALL_KEY = "__TMGF_CONTENT_STATE__";
  if (globalScope[INSTALL_KEY]?.installed) {
    return;
  }

  const core = globalScope.GwangjuFilterCore;
  if (!core) {
    throw new Error("광주권 필터 분류 모듈을 불러오지 못했습니다.");
  }

  const GWANGJU_CLASS = "__tmgf-gwangju";
  const JEONNAM_CLASS = "__tmgf-jeonnam";
  const MIXED_CLASS = "__tmgf-mixed";
  const BADGE_CLASS = "__tmgf-area-badge";
  const TEMP_HIDDEN_CLASS = "__tmgf-jeonnam-temporarily-hidden";
  const OPTION_TEMP_ATTR = "data-tmgf-option-temporarily-hidden";
  const OPTION_ORIGINAL_HIDDEN_ATTR = "data-tmgf-option-original-hidden";
  const STYLE_ID = "__tmgf-page-style";
  const OVERLAY_ID = "__tmgf-overlay-host";
  const CANDIDATE_SELECTOR = [
    "tr",
    "li",
    "article",
    "option",
    "button",
    "a",
    "[role='row']",
    "[role='listitem']",
    "[role='option']",
    "[role='menuitem']",
    "[class*='result']",
    "[class*='Result']",
    "[class*='card']",
    "[class*='Card']",
    "[class*='item']",
    "[class*='Item']"
  ].join(",");

  const state = {
    installed: true,
    mode: null,
    jeonnamHidden: false,
    observer: null,
    refreshTimer: null,
    applying: false,
    modifiedNodes: new Set(),
    badgeNodes: new Set(),
    lastSummary: null,
    richgoProvinceSelecting: false,
    dropdownInteractionHandler: null,
    dropdownRefreshTimers: new Set(),
    lastRefreshAt: 0
  };
  globalScope[INSTALL_KEY] = state;

  function isVmsHost() {
    return /(^|\.)vms\.or\.kr$/i.test(location.hostname);
  }

  function isRichgoHost() {
    return /(^|\.)richgo\.ai$/i.test(location.hostname);
  }

  function isExtensionArtifact(node) {
    if (node?.nodeType === Node.TEXT_NODE) {
      return isExtensionArtifact(node.parentElement);
    }
    if (!(node instanceof Element)) {
      return false;
    }
    return (
      node.id === OVERLAY_ID ||
      node.id === STYLE_ID ||
      node.classList.contains(BADGE_CLASS) ||
      Boolean(node.closest?.(`#${OVERLAY_ID}, .${BADGE_CLASS}`))
    );
  }

  function getElementText(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return core.normalizeText(
        [element.value, element.placeholder, element.getAttribute("aria-label")]
          .filter(Boolean)
          .join(" ")
      );
    }

    const textWithoutLayout = Array.from(element.childNodes)
      .map((node) => (isExtensionArtifact(node) ? "" : node.textContent || ""))
      .join(" ");
    return core.normalizeText(textWithoutLayout || element.textContent || "").slice(0, 6000);
  }

  function isOwnNode(element) {
    return isExtensionArtifact(element);
  }

  function isLikelyCandidate(element) {
    if (!(element instanceof Element) || isOwnNode(element)) {
      return false;
    }

    const tag = element.tagName;
    if (["TR", "LI", "ARTICLE", "OPTION", "BUTTON"].includes(tag)) {
      return true;
    }

    const role = element.getAttribute("role");
    if (["row", "listitem", "option", "menuitem"].includes(role)) {
      return true;
    }

    const className = typeof element.className === "string" ? element.className : "";
    if (/(?:result|card|item|place|region|area|location)/i.test(className)) {
      return true;
    }

    if (tag === "A") {
      const siblingLinks = element.parentElement?.querySelectorAll(":scope > a").length ?? 0;
      return siblingLinks >= 2;
    }

    return false;
  }

  function hasAdministrativeToken(text, name) {
    return new RegExp(
      "(?:^|[^가-힣])" + core.escapeRegExp(name) + "(?=$|[^가-힣])",
      "u"
    ).test(text);
  }

  function getGroupContext(element, children) {
    const vmsArea = document.querySelector("select#area, select[name='area']");
    const selectedAreaText = vmsArea?.selectedOptions?.[0]?.textContent || "";
    const childTexts = children.map(getElementText);
    const districtCount = core.GWANGJU_DISTRICTS.filter((name) =>
      childTexts.some((text) => hasAdministrativeToken(text, name))
    ).length;
    const localityCount = core.JEONNAM_LOCALITIES.filter((name) =>
      childTexts.some((text) => hasAdministrativeToken(text, name))
    ).length;
    const isConfirmedMixedRegionList = districtCount === 5 && localityCount >= 3;
    const isConfirmedVmsSelect =
      element instanceof HTMLSelectElement &&
      element.matches("#areagugun, [name='areagugun']") &&
      /전남\s*광주/u.test(selectedAreaText);
    const hasUnifiedContext = isConfirmedMixedRegionList || isConfirmedVmsSelect;

    return {
      unifiedScope: hasUnifiedContext,
      allowDistrictOnly: hasUnifiedContext
    };
  }

  function isInsideRichgoPicker(element) {
    return Boolean(
      isRichgoHost() &&
        element?.closest?.(
          "[class*='UISet_RichgoMap_CompSelectBJD'], [class*='UISet_RichgoMap_Pc_SelectBjd']"
        )
    );
  }

  function restoreNativeOption(option) {
    if (!(option instanceof HTMLOptionElement) || !option.hasAttribute(OPTION_TEMP_ATTR)) {
      return;
    }
    const wasHidden = option.getAttribute(OPTION_ORIGINAL_HIDDEN_ATTR) === "true";
    option.toggleAttribute("hidden", wasHidden);
    option.removeAttribute(OPTION_TEMP_ATTR);
    option.removeAttribute(OPTION_ORIGINAL_HIDDEN_ATTR);
  }

  function setTemporaryVisibility(element, hidden) {
    if (!(element instanceof Element)) {
      return;
    }
    element.classList.toggle(TEMP_HIDDEN_CLASS, Boolean(hidden));
    if (!(element instanceof HTMLOptionElement)) {
      return;
    }
    if (!hidden) {
      restoreNativeOption(element);
      return;
    }
    if (!element.hasAttribute(OPTION_TEMP_ATTR)) {
      element.setAttribute(
        OPTION_ORIGINAL_HIDDEN_ATTR,
        String(element.hasAttribute("hidden"))
      );
      element.setAttribute(OPTION_TEMP_ATTR, "true");
    }
    element.hidden = true;
  }

  function clearNodeMarks() {
    for (const option of document.querySelectorAll(`[${OPTION_TEMP_ATTR}]`)) {
      restoreNativeOption(option);
    }
    for (const badge of state.badgeNodes) {
      badge.remove();
    }
    state.badgeNodes.clear();

    for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) {
      badge.remove();
    }

    for (const node of state.modifiedNodes) {
      if (node instanceof Element) {
        restoreNativeOption(node);
        node.classList.remove(
          GWANGJU_CLASS,
          JEONNAM_CLASS,
          MIXED_CLASS,
          TEMP_HIDDEN_CLASS
        );
        node.removeAttribute("data-tmgf-area");
      }
    }
    state.modifiedNodes.clear();

    for (const node of document.querySelectorAll(
      `.${GWANGJU_CLASS}, .${JEONNAM_CLASS}, .${MIXED_CLASS}, .${TEMP_HIDDEN_CLASS}, [data-tmgf-area]`
    )) {
      node.classList.remove(
        GWANGJU_CLASS,
        JEONNAM_CLASS,
        MIXED_CLASS,
        TEMP_HIDDEN_CLASS
      );
      node.removeAttribute("data-tmgf-area");
    }
  }

  function badgeHostFor(element) {
    if (!(element instanceof Element)) {
      return null;
    }
    if (["OPTION", "SELECT", "INPUT", "TEXTAREA"].includes(element.tagName)) {
      return null;
    }
    if (element.tagName === "TR" || element.getAttribute("role") === "row") {
      return element.querySelector(":scope > td:last-child, :scope > th:last-child") ?? null;
    }
    return element;
  }

  function addAreaBadge(element, area) {
    const host = badgeHostFor(element);
    if (!host) {
      return;
    }
    for (const existing of host.querySelectorAll(`:scope > .${BADGE_CLASS}`)) {
      state.badgeNodes.delete(existing);
      existing.remove();
    }
    const labels = {
      gwangju: "광주권",
      jeonnam: "전남권",
      mixed: "광주·전남"
    };
    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${area}`;
    badge.textContent = labels[area];
    badge.setAttribute("aria-hidden", "true");
    host.append(badge);
    state.badgeNodes.add(badge);
  }

  function markNode(element, area) {
    if (!(element instanceof Element) || isOwnNode(element)) {
      return;
    }

    const classByArea = {
      gwangju: GWANGJU_CLASS,
      jeonnam: JEONNAM_CLASS,
      mixed: MIXED_CLASS
    };
    const areaClass = classByArea[area];
    if (!areaClass) {
      return;
    }
    element.classList.remove(GWANGJU_CLASS, JEONNAM_CLASS, MIXED_CLASS);
    element.classList.add(areaClass);
    setTemporaryVisibility(
      element,
      area === "jeonnam" && state.jeonnamHidden
    );
    element.dataset.tmgfArea = area;
    addAreaBadge(element, area);
    state.modifiedNodes.add(element);
  }

  function installPageStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${GWANGJU_CLASS} {
        outline: 2px solid rgba(28, 132, 77, 0.58) !important;
        outline-offset: -2px !important;
      }
      .${JEONNAM_CLASS} {
        outline: 2px solid rgba(37, 99, 180, 0.52) !important;
        outline-offset: -2px !important;
      }
      .${JEONNAM_CLASS}.${TEMP_HIDDEN_CLASS} {
        display: none !important;
      }
      .${MIXED_CLASS} {
        outline: 2px solid rgba(116, 75, 173, 0.56) !important;
        outline-offset: -2px !important;
      }
      option.${GWANGJU_CLASS} { color: #146b3a !important; font-weight: 700 !important; }
      option.${JEONNAM_CLASS} { color: #235fa4 !important; font-weight: 700 !important; }
      .${BADGE_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        width: auto !important;
        min-width: 0 !important;
        height: 20px !important;
        margin: 2px 4px 2px 8px !important;
        padding: 2px 7px !important;
        border: 1px solid transparent !important;
        border-radius: 999px !important;
        box-sizing: border-box !important;
        font: 700 11px/14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: -0.02em !important;
        vertical-align: middle !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      .${BADGE_CLASS}--gwangju {
        color: #126538 !important;
        border-color: rgba(28, 132, 77, 0.24) !important;
        background: #e6f6ec !important;
      }
      .${BADGE_CLASS}--jeonnam {
        color: #225b9d !important;
        border-color: rgba(37, 99, 180, 0.22) !important;
        background: #e9f1fb !important;
      }
      .${BADGE_CLASS}--mixed {
        color: #694197 !important;
        border-color: rgba(116, 75, 173, 0.22) !important;
        background: #f0eafb !important;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function depthOf(element) {
    let depth = 0;
    for (let current = element; current?.parentElement; current = current.parentElement) {
      depth += 1;
    }
    return depth;
  }

  function directCandidateChildren(parent) {
    if (!(parent instanceof Element)) {
      return [];
    }

    if (parent instanceof HTMLSelectElement) {
      return Array.from(parent.options);
    }

    return Array.from(parent.children).filter(isLikelyCandidate);
  }

  function discoverOpaqueGroupParents() {
    const parents = new Set();
    if (!document.body) {
      return parents;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();

    while (textNode) {
      const text = core.normalizeText(textNode.nodeValue || "");
      const owner = textNode.parentElement;
      if (
        owner &&
        !isOwnNode(owner) &&
        !isInsideRichgoPicker(owner) &&
        text.length > 0 &&
        text.length <= 320 &&
        core.hasLocationSignal(text)
      ) {
        let item = owner;
        for (let level = 0; item?.parentElement && level < 5; level += 1) {
          const parent = item.parentElement;
          if (parent === document.body || parent === document.documentElement || isOwnNode(parent)) {
            break;
          }
          const children = Array.from(parent.children);
          if (children.length >= 2 && children.length <= 250) {
            let evidenceCount = 0;
            for (const child of children) {
              const childText = getElementText(child);
              if (
                childText.length > 0 &&
                childText.length <= 3000 &&
                core.hasLocationSignal(childText)
              ) {
                evidenceCount += 1;
                if (evidenceCount >= 2) {
                  parents.add(parent);
                  break;
                }
              }
            }
            if (parents.has(parent)) {
              break;
            }
          }
          item = parent;
        }
      }
      textNode = walker.nextNode();
    }

    return parents;
  }

  function emptySummary() {
    return {
      groups: 0,
      gwangju: 0,
      jeonnam: 0,
      mixed: 0,
      unknown: 0,
      other: 0
    };
  }

  function applyGenericGroups() {
    const possibleParents = new Set();
    const opaqueParents = discoverOpaqueGroupParents();
    const elements = document.querySelectorAll(CANDIDATE_SELECTOR);

    for (const element of elements) {
      if (!isLikelyCandidate(element)) {
        continue;
      }
      const text = getElementText(element);
      if (text.length >= 6000 || !core.hasLocationSignal(text)) {
        continue;
      }
      if (element.parentElement) {
        possibleParents.add(element.parentElement);
      }
    }
    for (const parent of opaqueParents) {
      possibleParents.add(parent);
    }

    const parents = Array.from(possibleParents).sort((left, right) => depthOf(right) - depthOf(left));
    const processed = new Set();
    const summary = emptySummary();

    for (const parent of parents) {
      if (isInsideRichgoPicker(parent)) {
        continue;
      }
      const sourceChildren = opaqueParents.has(parent)
        ? Array.from(parent.children)
        : directCandidateChildren(parent);
      const children = sourceChildren.filter(
        (child) => child instanceof Element && !isOwnNode(child) && !processed.has(child)
      );
      if (children.length < 2) {
        continue;
      }

      const context = getGroupContext(parent, children);
      const records = children.map((child) => {
        const text = getElementText(child);
        const classification = core.classifyLocation(text, context);
        return {
          child,
          classification
        };
      });
      const classifiedCount = records.filter(
        (record) => record.classification.area !== "unknown"
      ).length;
      const weakCount = records.filter(
        (record) => record.classification.confidence === "weak"
      ).length;
      const isSelect = parent instanceof HTMLSelectElement;

      if (classifiedCount < 2 && !(isSelect && classifiedCount + weakCount >= 3)) {
        continue;
      }

      const markSelector = `.${GWANGJU_CLASS}, .${JEONNAM_CLASS}, .${MIXED_CLASS}`;
      const actionableRecords = records.filter(
        (record) =>
          !record.child.querySelector(markSelector) && core.splitMark(record.classification)
      );
      if (actionableRecords.length === 0) {
        continue;
      }

      summary.groups += 1;
      for (const record of records) {
        processed.add(record.child);
        if (record.child.querySelector(markSelector)) {
          continue;
        }
        const area = record.classification.area;
        const splitMark = core.splitMark(record.classification);
        if (splitMark) {
          markNode(record.child, splitMark);
          summary[splitMark] += 1;
        } else if (area === "other") {
          summary.other += 1;
        } else {
          summary.unknown += 1;
        }
      }
    }

    return summary;
  }

  function exactLeafMatches(container, names) {
    const nameSet = new Set(names);
    return Array.from(container.querySelectorAll("button, a, li, [role='option'], [role='menuitem'], div, span, p"))
      .filter((element) => nameSet.has(getElementText(element)))
      .filter((element) =>
        !Array.from(element.children).some((child) => nameSet.has(getElementText(child)))
      );
  }

  function smallestRichgoRegionContainer() {
    if (!isRichgoHost()) {
      return null;
    }

    const containers = Array.from(
      document.querySelectorAll("[role='dialog'], aside, section, ul, div")
    ).filter((container) => {
      const text = getElementText(container);
      if (!/전남\s*광주/u.test(text)) {
        return false;
      }
      const districtCount = core.GWANGJU_DISTRICTS.filter(
        (name) => exactLeafMatches(container, [name]).length > 0
      ).length;
      const localityCount = core.JEONNAM_LOCALITIES.filter(
        (name) => exactLeafMatches(container, [name]).length > 0
      ).length;
      return (
        districtCount === core.GWANGJU_DISTRICTS.length &&
        localityCount === core.JEONNAM_LOCALITIES.length
      );
    });

    return containers.sort(
      (left, right) => getElementText(left).length - getElementText(right).length
    )[0] ?? null;
  }

  function clickableRegionItem(labelElement, container) {
    const clickable = labelElement.closest(
      "button, a, li, [role='option'], [role='menuitem'], [tabindex]"
    );
    if (clickable && container.contains(clickable)) {
      return clickable;
    }
    return labelElement;
  }

  function applyRichgoAdapter() {
    const container = smallestRichgoRegionContainer();
    if (!container) {
      return null;
    }

    const districtLabels = exactLeafMatches(container, core.GWANGJU_DISTRICTS);
    const localityLabels = exactLeafMatches(container, core.JEONNAM_LOCALITIES);
    if (
      districtLabels.length < core.GWANGJU_DISTRICTS.length ||
      localityLabels.length < core.JEONNAM_LOCALITIES.length
    ) {
      return null;
    }

    const touched = new Set();

    for (const label of districtLabels) {
      const item = clickableRegionItem(label, container);
      if (!touched.has(item)) {
        markNode(item, "gwangju");
        touched.add(item);
      }
    }

    for (const label of localityLabels) {
      const item = clickableRegionItem(label, container);
      if (!touched.has(item)) {
        markNode(item, "jeonnam");
        touched.add(item);
      }
    }

    return {
      groups: 1,
      gwangju: new Set(
        districtLabels.map((label) => clickableRegionItem(label, container))
      ).size,
      jeonnam: new Set(
        localityLabels.map((label) => clickableRegionItem(label, container))
      ).size,
      mixed: 0,
      unknown: 0,
      other: 0,
      siteNote: "리치고의 27개 지역을 모두 남기고 광주권 5개와 전남권 22개로 구분했습니다."
    };
  }

  function richgoPickerItems() {
    return Array.from(
      document.querySelectorAll(
        "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item']"
      )
    );
  }

  function exactRichgoPickerItem(label) {
    return richgoPickerItems().find((element) => getElementText(element) === label) ?? null;
  }

  function prepareRichgoPicker() {
    if (!isRichgoHost() || state.mode !== "split") {
      return false;
    }

    if (smallestRichgoRegionContainer()) {
      return true;
    }

    const provinceItem = exactRichgoPickerItem("전남광주");
    if (provinceItem && !state.richgoProvinceSelecting) {
      state.richgoProvinceSelecting = true;
      provinceItem.click();
      setTimeout(() => {
        state.richgoProvinceSelecting = false;
        scheduleRefresh();
      }, 220);
      return true;
    }
    return false;
  }

  function waitForElement(getter, timeoutMs = 3500, intervalMs = 100) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        const result = getter();
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("리치고 지역 선택창 응답 시간이 초과되었습니다."));
          return;
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  async function richgoDistrictNavigate(district) {
    if (!isRichgoHost() || !core.GWANGJU_DISTRICTS.includes(district)) {
      return { ok: false, error: "지원하지 않는 리치고 지역입니다." };
    }

    let container = smallestRichgoRegionContainer();
    if (!container) {
      const provinceItem = exactRichgoPickerItem("전남광주");
      if (!provinceItem) {
        return {
          ok: false,
          error: "리치고 지도 아래 현재 지역명을 먼저 한 번 눌러 지역 선택창을 열어주세요."
        };
      }
      provinceItem.click();
      container = await waitForElement(() => smallestRichgoRegionContainer());
    }
    const districtLabel = exactLeafMatches(container, [district])[0];
    if (!districtLabel) {
      return {
        ok: false,
        error: "리치고의 전남광주 " + district + " 항목을 찾지 못했습니다."
      };
    }
    const districtItem = clickableRegionItem(districtLabel, container);
    districtItem.click();
    const moveButton = await waitForElement(() =>
      Array.from(
        document.querySelectorAll(
          "[class*='UISet_RichgoMap_CompSelectBJD__SD_Go'], button, [role='button']"
        )
      ).find((element) => {
        const text = getElementText(element);
        return (
          text.includes(district) &&
          /이동$/u.test(text) &&
          element.getClientRects().length > 0
        );
      })
    );
    moveButton.click();
    return { ok: true };
  }

  function addSummaries(base, addition) {
    if (!addition) {
      return base;
    }
    return {
      groups: base.groups + addition.groups,
      gwangju: base.gwangju + addition.gwangju,
      jeonnam: base.jeonnam + addition.jeonnam,
      mixed: base.mixed + addition.mixed,
      unknown: base.unknown + addition.unknown,
      other: base.other + addition.other,
      siteNote: addition.siteNote || base.siteNote
    };
  }

  function vmsResultNote(jeonnamHidden) {
    return jeonnamHidden
      ? "VMS 결과카드는 세부 지역 근거가 없어 그대로 뒀습니다. 지역 선택 목록에서 확인된 전남권 선택지만 잠시 숨겼습니다."
      : "VMS 결과카드에는 세부 구·시·군 정보가 없어 추측해서 구분하지 않았습니다. 확장창의 광주 5구 버튼으로 다시 조회할 수 있습니다.";
  }

  function vmsSiteNote(summary) {
    if (!isVmsHost() || !/\/partspace\/recruit\.do$/i.test(location.pathname)) {
      return summary;
    }

    return {
      ...summary,
      siteKind: "vms",
      siteNote: vmsResultNote(state.jeonnamHidden)
    };
  }

  function refreshFilter() {
    if (!state.mode || state.applying || !document.body) {
      return state.lastSummary;
    }

    state.applying = true;
    try {
      clearNodeMarks();
      installPageStyle();
      let summary = applyGenericGroups();
      const richgoSummary = applyRichgoAdapter();
      summary = addSummaries(summary, richgoSummary);
      if (isRichgoHost() && state.mode === "split" && !richgoSummary) {
        const pickerWasOpen = prepareRichgoPicker();
        summary.siteNote = pickerWasOpen
          ? "리치고의 전남광주 지역 목록을 불러오고 있습니다."
          : "리치고 지도 아래 현재 지역명을 열면 27개 지역을 광주권과 전남권으로 구분합니다.";
      }
      summary = vmsSiteNote(summary);
      summary.jeonnamHidden = state.jeonnamHidden;
      state.lastSummary = summary;
      renderOverlay(summary);
      return summary;
    } finally {
      state.applying = false;
      state.lastRefreshAt = Date.now();
    }
  }

  function scheduleRefresh() {
    if (!state.mode) {
      return;
    }
    if (state.refreshTimer) {
      return;
    }
    if (state.applying) {
      state.refreshTimer = setTimeout(() => {
        state.refreshTimer = null;
        scheduleRefresh();
      }, 80);
      return;
    }
    const elapsed = Date.now() - state.lastRefreshAt;
    const delay = Math.max(120, 420 - elapsed);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      refreshFilter();
    }, delay);
  }

  function isDropdownInteractionTarget(target) {
    if (!(target instanceof Element) || isOwnNode(target)) {
      return false;
    }
    return Boolean(
      target.closest(
        "select, [role='combobox'], [aria-haspopup='listbox'], [class*='dropdown' i], [class~='select' i], [class*='selectbox' i], [class*='select-' i], [class*='-select' i], [class*='selectbjd' i]"
      )
    );
  }

  function queueDropdownRefreshes() {
    for (const timer of state.dropdownRefreshTimers) {
      clearTimeout(timer);
    }
    state.dropdownRefreshTimers.clear();
    for (const delay of [80, 460]) {
      const timer = setTimeout(() => {
        state.dropdownRefreshTimers.delete(timer);
        scheduleRefresh();
      }, delay);
      state.dropdownRefreshTimers.add(timer);
    }
  }

  function ensureDropdownInteractionHandler() {
    if (state.dropdownInteractionHandler) {
      return;
    }

    state.dropdownInteractionHandler = (event) => {
      if (!state.mode || !isDropdownInteractionTarget(event.target)) {
        return;
      }
      if (
        event.type === "keydown" &&
        !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
      ) {
        return;
      }
      queueDropdownRefreshes();
    };

    for (const eventName of ["click", "change", "keydown"]) {
      document.addEventListener(eventName, state.dropdownInteractionHandler, true);
    }
  }

  function removeDropdownInteractionHandler() {
    if (state.dropdownInteractionHandler) {
      for (const eventName of ["click", "change", "keydown"]) {
        document.removeEventListener(eventName, state.dropdownInteractionHandler, true);
      }
      state.dropdownInteractionHandler = null;
    }
    for (const timer of state.dropdownRefreshTimers) {
      clearTimeout(timer);
    }
    state.dropdownRefreshTimers.clear();
  }

  function longTextHasLocationSignal(rawText) {
    const text = String(rawText || "");
    const chunkSize = 5600;
    const overlap = 120;
    for (let offset = 0; offset < text.length; offset += chunkSize - overlap) {
      if (core.hasLocationSignal(text.slice(offset, offset + chunkSize))) {
        return true;
      }
    }
    return false;
  }

  function mutationHasLocationSignal(mutation) {
    if (isOwnNode(mutation.target)) {
      return false;
    }

    if (mutation.type === "characterData") {
      return longTextHasLocationSignal(mutation.target.nodeValue || "");
    }

    for (const node of mutation.addedNodes) {
      if (isExtensionArtifact(node)) {
        continue;
      }
      let text = "";
      if (node.nodeType === Node.TEXT_NODE) {
        text = node.nodeValue || "";
      } else if (node instanceof Element) {
        text = node.textContent || "";
      }
      if (text && longTextHasLocationSignal(text)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (isExtensionArtifact(node) || node.classList.contains(BADGE_CLASS)) {
        continue;
      }
      if (state.modifiedNodes.has(node)) {
        return true;
      }
      for (const modified of state.modifiedNodes) {
        if (node.contains(modified)) {
          return true;
        }
      }
    }

    return false;
  }

  function ensureObserver() {
    state.observer?.disconnect();
    state.observer = new MutationObserver((mutations) => {
      if (!mutations.some(mutationHasLocationSignal)) {
        return;
      }
      scheduleRefresh();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function setJeonnamHidden(hidden) {
    if (state.mode !== "split") {
      applyFilter("split");
    }

    state.jeonnamHidden = Boolean(hidden);
    const connectedJeonnamNodes = Array.from(
      document.querySelectorAll(`.${JEONNAM_CLASS}`)
    );
    const jeonnamNodes = new Set(connectedJeonnamNodes);
    for (const node of state.modifiedNodes) {
      if (node instanceof Element && node.classList.contains(JEONNAM_CLASS)) {
        jeonnamNodes.add(node);
      }
    }
    for (const node of jeonnamNodes) {
      setTemporaryVisibility(node, state.jeonnamHidden);
    }

    const summary = {
      ...(state.lastSummary || emptySummary()),
      jeonnamHidden: state.jeonnamHidden,
      temporarilyHidden: state.jeonnamHidden ? connectedJeonnamNodes.length : 0
    };
    if (summary.siteKind === "vms") {
      summary.siteNote = vmsResultNote(state.jeonnamHidden);
    }
    state.lastSummary = summary;
    renderOverlay(summary);
    return summary;
  }

  function toggleJeonnamHidden() {
    return setJeonnamHidden(!state.jeonnamHidden);
  }

  function summaryText(summary) {
    if (summary.siteKind === "vms" && summary.siteNote) {
      return summary.siteNote;
    }
    if (summary.jeonnamHidden) {
      if (summary.jeonnam > 0) {
        return `전남권 ${summary.jeonnam}개를 잠시 숨겼습니다. 광주권과 혼합 항목은 그대로 보입니다.`;
      }
      return "전남권 잠시 숨기기를 켰습니다. 새로 확인되는 전남권 항목도 숨깁니다.";
    }
    if (summary.siteNote) {
      return summary.siteNote;
    }
    if (summary.groups === 0) {
      return "판별 가능한 반복 지역 목록을 찾지 못해 화면을 그대로 두었습니다.";
    }
    const parts = [
      `광주권 ${summary.gwangju}개`,
      `전남권 ${summary.jeonnam}개`
    ];
    if (summary.mixed > 0) {
      parts.push(`광주·전남 ${summary.mixed}개`);
    }
    if (summary.unknown > 0) {
      parts.push(`판정 보류 ${summary.unknown}개`);
    }
    return `${parts.join(" · ")}를 표시했습니다. 모든 항목은 그대로 남아 있습니다.`;
  }

  function renderOverlay(summary) {
    let host = document.getElementById(OVERLAY_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = OVERLAY_ID;
      host.style.setProperty("all", "initial", "important");
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("right", "16px", "important");
      host.style.setProperty("bottom", "16px", "important");
      host.style.setProperty("z-index", "2147483647", "important");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .panel {
            width: min(330px, calc(100vw - 32px));
            padding: 12px 12px 10px;
            border: 1px solid rgba(32, 109, 65, 0.24);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(21, 54, 34, 0.18);
            color: #17331f;
            background: rgba(247, 253, 249, 0.97);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
          .actions { display: flex; gap: 6px; margin-left: auto; }
          strong { font-size: 13px; }
          p { margin: 6px 0 0; color: #516359; font-size: 11px; line-height: 1.45; }
          button {
            flex: 0 0 auto;
            padding: 6px 8px;
            border: 0;
            border-radius: 7px;
            color: #31533d;
            background: #e5f0e8;
            font: 700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            cursor: pointer;
          }
        </style>
        <div class="panel">
          <div class="top">
            <strong id="title"></strong>
            <div class="actions">
              <button type="button" id="toggle-jeonnam"></button>
              <button type="button" id="clear">표시 지우기</button>
            </div>
          </div>
          <p id="summary"></p>
        </div>
      `;
      shadow.getElementById("toggle-jeonnam").addEventListener("click", toggleJeonnamHidden);
      shadow.getElementById("clear").addEventListener("click", clearFilter);
      document.documentElement.append(host);
    }

    const shadow = host.shadowRoot;
    shadow.getElementById("title").textContent = state.jeonnamHidden
      ? "광주권 임시 보기 중"
      : "광주권·전남권 구분 표시 중";
    shadow.getElementById("toggle-jeonnam").textContent = state.jeonnamHidden
      ? "전남권 다시 보기"
      : "전남권 잠시 숨기기";
    shadow.getElementById("summary").textContent = summaryText(summary);
  }

  function applyFilter(mode) {
    if (mode !== "split") {
      throw new Error("지원하지 않는 표시 모드입니다.");
    }

    state.mode = mode;
    state.jeonnamHidden = false;
    installPageStyle();
    ensureObserver();
    ensureDropdownInteractionHandler();
    const summary = refreshFilter();
    return summary;
  }

  function clearFilter() {
    state.mode = null;
    state.jeonnamHidden = false;
    state.observer?.disconnect();
    state.observer = null;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    removeDropdownInteractionHandler();
    state.richgoProvinceSelecting = false;
    clearNodeMarks();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    state.lastSummary = null;
    return true;
  }

  function vmsDistrictSearch(code) {
    const districtCodes = new Set([
      "1221000000",
      "1224000000",
      "1227000000",
      "1230000000",
      "1233000000"
    ]);
    if (!isVmsHost() || !districtCodes.has(String(code))) {
      return { ok: false, error: "지원하지 않는 VMS 지역입니다." };
    }

    const form = document.querySelector("form#searchFm");
    if (!(form instanceof HTMLFormElement)) {
      return {
        ok: false,
        error: "VMS의 ‘봉사자 모집 및 신청’ 검색화면에서 사용해주세요."
      };
    }

    const target = new URL(form.action || "/partspace/recruit.do", location.href);
    if (
      target.origin !== location.origin ||
      !/\/partspace\/recruit\.do$/i.test(target.pathname)
    ) {
      return {
        ok: false,
        error: "VMS 공식 모집 검색주소를 확인할 수 없어 이동하지 않았습니다."
      };
    }

    const formData = new FormData(form);
    const params = new URLSearchParams();
    for (const [name, value] of formData.entries()) {
      if (typeof value === "string") {
        params.append(name, value);
      }
    }
    params.set("area", "0118");
    params.set("areagugun", String(code));
    params.set("page", "1");

    target.search = params.toString();
    setTimeout(() => location.assign(target.href), 80);
    return { ok: true, target: target.href };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "TMGF_APPLY") {
        const summary = applyFilter(message.mode);
        sendResponse({ ok: true, summary });
        return false;
      }
      if (message?.type === "TMGF_CLEAR") {
        sendResponse({ ok: clearFilter() });
        return false;
      }
      if (message?.type === "TMGF_SET_JEONNAM_HIDDEN") {
        const summary = setJeonnamHidden(message.hidden === true);
        sendResponse({
          ok: true,
          hidden: state.jeonnamHidden,
          affected: summary.temporarilyHidden,
          summary
        });
        return false;
      }
      if (message?.type === "TMGF_VMS_DISTRICT") {
        sendResponse(vmsDistrictSearch(message.code));
        return false;
      }
      if (message?.type === "TMGF_RICHGO_DISTRICT") {
        richgoDistrictNavigate(message.district)
          .then(sendResponse)
          .catch((error) =>
            sendResponse({
              ok: false,
              error: error?.message || "리치고 지역 이동을 완료하지 못했습니다."
            })
          );
        return true;
      }
      if (message?.type === "TMGF_STATUS") {
        sendResponse({
          ok: true,
          summary: state.lastSummary,
          mode: state.mode,
          jeonnamHidden: state.jeonnamHidden
        });
        return false;
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "알 수 없는 오류" });
      return false;
    }
    return false;
  });
})(globalThis);
