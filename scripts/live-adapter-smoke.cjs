const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const outputDir = path.join(workspaceRoot, "output", "playwright", "gwangju-filter-live");
const profilePrefix = path.join(os.tmpdir(), "gwangju-filter-live-");
const userDataDir = fs.mkdtempSync(profilePrefix);

const districts = ["동구", "서구", "남구", "북구", "광산구"];
const localities = [
  "목포시", "여수시", "순천시", "나주시", "광양시", "담양군", "곡성군",
  "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군", "해남군",
  "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군"
];

async function injectContentHarness(page) {
  await page.evaluate(() => {
    globalThis.__TMGF_TEST_LISTENERS__ = [];
    const chromeObject = globalThis.chrome || {};
    chromeObject.runtime = {
      onMessage: {
        addListener(listener) {
          globalThis.__TMGF_TEST_LISTENERS__.push(listener);
        }
      }
    };
    globalThis.chrome = chromeObject;
  });
  await page.addScriptTag({ path: path.join(projectRoot, "src", "core.js") });
  await page.addScriptTag({ path: path.join(projectRoot, "src", "content.js") });
}

async function sendContentMessage(page, message) {
  return page.evaluate(
    (payload) =>
      new Promise((resolve, reject) => {
        const listener = globalThis.__TMGF_TEST_LISTENERS__?.[0];
        if (!listener) {
          reject(new Error("Content-script message listener was not installed."));
          return;
        }
        let settled = false;
        const sendResponse = (response) => {
          settled = true;
          resolve(response);
        };
        const keepChannelOpen = listener(payload, {}, sendResponse);
        if (keepChannelOpen !== true && !settled) {
          resolve(undefined);
        }
      }),
    message
  );
}

async function popupSmoke(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 760 });
  await page.addInitScript(() => {
    let jeonnamHidden = false;
    globalThis.chrome = {
      tabs: {
        async query() {
          return [{ id: 1, url: "https://example.com/regions" }];
        },
        async sendMessage(_tabId, message) {
          if (message.type === "TMGF_STATUS") {
            return { ok: true, jeonnamHidden, summary: null };
          }
          if (message.type === "TMGF_SET_JEONNAM_HIDDEN") {
            jeonnamHidden = Boolean(message.hidden);
            return {
              ok: true,
              hidden: jeonnamHidden,
              summary: {
                groups: 1,
                gwangju: 5,
                jeonnam: 22,
                mixed: 0,
                unknown: 0,
                jeonnamHidden
              }
            };
          }
          return { ok: true, summary: null };
        }
      },
      scripting: { async executeScript() {} },
      runtime: {}
    };
  });
  await page.goto(pathToFileURL(path.join(projectRoot, "popup", "popup.html")).href);
  const popupState = await page.evaluate(() => ({
    splitButtons: document.querySelectorAll("[data-mode='split']").length,
    filterButtons: document.querySelectorAll(
      "[data-mode='gwangju'], [data-mode='jeonnam']"
    ).length,
    saysNothingHidden: document.body.textContent.includes("아무것도 숨기지 않고"),
    temporaryToggle: document.querySelectorAll("#toggle-jeonnam").length,
    temporaryLabel: document.querySelector("#toggle-jeonnam span")?.textContent.trim(),
    temporaryPressed: document.querySelector("#toggle-jeonnam")?.getAttribute("aria-pressed"),
    vmsHidden: document.querySelector("#vms-tools").hidden,
    richgoHidden: document.querySelector("#richgo-tools").hidden
  }));
  assert.deepEqual(popupState, {
    splitButtons: 1,
    filterButtons: 0,
    saysNothingHidden: true,
    temporaryToggle: 1,
    temporaryLabel: "전남권 잠시 숨기기",
    temporaryPressed: "false",
    vmsHidden: true,
    richgoHidden: true
  });
  fs.mkdirSync(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, "popup-split-first.png"), fullPage: true });
  await page.locator("#toggle-jeonnam").click();
  await page.waitForFunction(() =>
    document.querySelector("#toggle-jeonnam")?.getAttribute("aria-pressed") === "true"
  );
  assert.equal(
    await page.locator("#toggle-jeonnam span").textContent(),
    "전남권 다시 보기"
  );
  await page.locator("#toggle-jeonnam").click();
  await page.waitForFunction(() =>
    document.querySelector("#toggle-jeonnam")?.getAttribute("aria-pressed") === "false"
  );
  await page.close();
  return "Popup split-first UI + reversible Jeonnam toggle: OK";
}

async function popupWebStoreSmoke(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__TMGF_INJECTION_ATTEMPTED__ = false;
    globalThis.chrome = {
      tabs: {
        async query() {
          return [
            {
              id: 2,
              url: "https://chromewebstore.google.com/detail/example/abcdefghijklmnop"
            }
          ];
        }
      },
      scripting: {
        async executeScript() {
          globalThis.__TMGF_INJECTION_ATTEMPTED__ = true;
        }
      },
      runtime: {}
    };
  });
  await page.goto(pathToFileURL(path.join(projectRoot, "popup", "popup.html")).href);
  await page.waitForFunction(
    () => document.querySelector("#status")?.dataset.error === "true"
  );
  const result = await page.evaluate(() => ({
    message: document.querySelector("#status")?.textContent || "",
    injectionAttempted: globalThis.__TMGF_INJECTION_ATTEMPTED__
  }));
  assert.match(result.message, /웹스토어/u);
  assert.equal(result.injectionAttempted, false);
  await page.close();
  return "Popup rejects Chrome Web Store before injection: OK";
}

async function genericListSmoke(context) {
  const page = await context.newPage();
  const regionItems = [...districts, ...localities]
    .map((name) => `<li data-region="${name}">${name} 지역 게시물</li>`)
    .join("");
  const opaqueRegionItems = [...districts, ...localities]
    .map((name) => `<div class="x-${name.length}" data-opaque-region="${name}"><span>${name}</span><b>생활정보</b></div>`)
    .join("");
  const fillerItems = Array.from(
    { length: 5100 },
    (_, index) => '<button type="button">무관 항목 ' + index + '</button>'
  ).join("");
  await page.setContent(`
    <!doctype html>
    <html lang="ko">
      <body>
        <main>
          <section id="large-page-filler">${fillerItems}</section>
          <section id="unified-region">
            <h2>전남광주 지역 목록</h2>
            <ul id="regions">${regionItems}</ul>
          </section>
          <section id="nationwide">
            <h2>전국 목록</h2>
            <ul>
              <li data-nationwide="gwangju">광주광역시 북구 모집</li>
              <li data-nationwide="busan">부산광역시 남구 모집</li>
              <li data-nationwide="gyeonggi">경기도 광주시 모집</li>
              <li data-nationwide="unknown">남구 복지관 모집</li>
              <li data-nationwide="mixed">광주 및 전남 지역 공동 모집</li>
            </ul>
          </section>
          <section id="opaque-region">
            <h2>전남광주 통합 지역</h2>
            <div class="opaque-list">${opaqueRegionItems}</div>
          </section>
        </main>
      </body>
    </html>
  `);
  await injectContentHarness(page);
  const response = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(response.ok, true);
  assert.equal(response.summary.jeonnamHidden, false);

  const result = await page.evaluate(({ districts: districtNames, localities: localityNames }) => {
    const byRegion = new Map(
      Array.from(document.querySelectorAll("[data-region]")).map((item) => [
        item.dataset.region,
        item
      ])
    );
    return {
      hiddenCount: document.querySelectorAll(".__tmgf-hidden").length,
      districtsMarked: districtNames.every((name) =>
        byRegion.get(name)?.classList.contains("__tmgf-gwangju")
      ),
      localitiesMarked: localityNames.every((name) =>
        byRegion.get(name)?.classList.contains("__tmgf-jeonnam")
      ),
      allRegionItemsVisible: Array.from(byRegion.values()).every(
        (item) => getComputedStyle(item).display !== "none"
      ),
      nationwideGwangjuMarked: document
        .querySelector("[data-nationwide='gwangju']")
        .classList.contains("__tmgf-gwangju"),
      nationwideBusanUnmarked: !document
        .querySelector("[data-nationwide='busan']")
        .matches(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed"),
      gyeonggiGwangjuUnmarked: !document
        .querySelector("[data-nationwide='gyeonggi']")
        .matches(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed"),
      ambiguousUnmarked: !document
        .querySelector("[data-nationwide='unknown']")
        .matches(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed"),
      mixedMarked: document
        .querySelector("[data-nationwide='mixed']")
        .classList.contains("__tmgf-mixed"),
      opaqueDistrictsMarked: districtNames.every((name) =>
        document.querySelector(`[data-opaque-region='${name}']`).classList.contains("__tmgf-gwangju")
      ),
      opaqueLocalitiesMarked: localityNames.every((name) =>
        document.querySelector(`[data-opaque-region='${name}']`).classList.contains("__tmgf-jeonnam")
      ),
      badgeCount: document.querySelectorAll(".__tmgf-area-badge").length
    };
  }, { districts, localities });
  if (result.badgeCount !== 56) {
    const markedDiagnostics = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed")
      ).map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: element.className,
        dataRegion:
          element.dataset.region ||
          element.dataset.opaqueRegion ||
          element.dataset.nationwide ||
          null,
        area: element.dataset.tmgfArea,
        text: element.textContent.trim().slice(0, 120)
      }))
    );
    console.error(JSON.stringify({ unexpectedGenericMarks: markedDiagnostics }, null, 2));
  }
  assert.deepEqual(result, {
    hiddenCount: 0,
    districtsMarked: true,
    localitiesMarked: true,
    allRegionItemsVisible: true,
    nationwideGwangjuMarked: true,
    nationwideBusanUnmarked: true,
    gyeonggiGwangjuUnmarked: true,
    ambiguousUnmarked: true,
    mixedMarked: true,
    opaqueDistrictsMarked: true,
    opaqueLocalitiesMarked: true,
    badgeCount: 56
  });

  await page.waitForTimeout(800);
  const stableRefreshAt = await page.evaluate(
    () => globalThis.__TMGF_CONTENT_STATE__?.lastRefreshAt
  );
  await page.evaluate(() => {
    const badgeText = document.querySelector(".__tmgf-area-badge")?.firstChild;
    if (badgeText) {
      badgeText.nodeValue = `${badgeText.nodeValue} 번역`;
    }
  });
  await page.waitForTimeout(800);
  assert.equal(
    await page.evaluate(() => globalThis.__TMGF_CONTENT_STATE__?.lastRefreshAt),
    stableRefreshAt,
    "Extension-owned badges must not create an observer refresh loop."
  );

  const hideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideResponse.ok, true);
  assert.equal(hideResponse.hidden, true);
  assert.equal(hideResponse.affected, 44);
  const hiddenState = await page.evaluate(({ expectedOrder }) => {
    const regionItems = Array.from(document.querySelectorAll("[data-region]"));
    const temporarilyHidden = Array.from(
      document.querySelectorAll(".__tmgf-jeonnam-temporarily-hidden")
    );
    return {
      hiddenCount: temporarilyHidden.length,
      allJeonnamNotDisplayed: temporarilyHidden.every(
        (item) => getComputedStyle(item).display === "none"
      ),
      gwangjuVisible: Array.from(document.querySelectorAll(".__tmgf-gwangju")).every(
        (item) => getComputedStyle(item).display !== "none"
      ),
      mixedVisible: Array.from(document.querySelectorAll(".__tmgf-mixed")).every(
        (item) => getComputedStyle(item).display !== "none"
      ),
      otherVisible: ["busan", "gyeonggi", "unknown"].every(
        (key) =>
          getComputedStyle(document.querySelector(`[data-nationwide='${key}']`)).display !==
          "none"
      ),
      orderUnchanged:
        regionItems.slice(0, expectedOrder.length).map((item) => item.dataset.region).join("|") ===
        expectedOrder.join("|")
    };
  }, { expectedOrder: [...districts, ...localities] });
  assert.deepEqual(hiddenState, {
    hiddenCount: 44,
    allJeonnamNotDisplayed: true,
    gwangjuVisible: true,
    mixedVisible: true,
    otherVisible: true,
    orderUnchanged: true
  });

  const repeatedHideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(repeatedHideResponse.hidden, true);
  assert.equal(repeatedHideResponse.affected, 44);

  await page.evaluate(() => {
    const item = document.createElement("li");
    item.dataset.region = "late-mokpo";
    item.textContent = "전남광주통합특별시 목포시 새 게시물";
    document.querySelector("#regions").append(item);
  });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-region='late-mokpo']")
      ?.classList.contains("__tmgf-jeonnam-temporarily-hidden") &&
    getComputedStyle(document.querySelector("[data-region='late-mokpo']")).display === "none"
  );

  await page.evaluate(() => {
    const wrapper = document.createElement("section");
    wrapper.id = "late-large-wrapper";
    const filler = document.createElement("p");
    filler.textContent = "무관".repeat(3500);
    const list = document.createElement("ul");
    list.innerHTML =
      '<li data-late-large="gwangju">광주광역시 북구 새 항목</li>' +
      '<li data-late-large="busan">부산광역시 남구 새 항목</li>';
    wrapper.append(filler, list);
    document.querySelector("main").append(wrapper);
  });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-late-large='gwangju']")
      ?.classList.contains("__tmgf-gwangju")
  );
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector("[data-late-large='busan']")
        .matches(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed")
    ),
    false
  );

  await page.evaluate(() => {
    const source = document.querySelector("[data-region='목포시']");
    const clone = source.cloneNode(true);
    clone.dataset.region = "cloned-mokpo";
    document.querySelector("#regions").append(clone);
  });

  const showResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: false
  });
  assert.equal(showResponse.ok, true);
  assert.equal(showResponse.hidden, false);
  assert.deepEqual(
    await page.evaluate(() => ({
      temporaryClasses: document.querySelectorAll(
        ".__tmgf-jeonnam-temporarily-hidden"
      ).length,
      allJeonnamVisible: Array.from(document.querySelectorAll(".__tmgf-jeonnam")).every(
        (item) => getComputedStyle(item).display !== "none"
      ),
      cloneVisible:
        getComputedStyle(document.querySelector("[data-region='cloned-mokpo']")).display !==
        "none"
    })),
    { temporaryClasses: 0, allJeonnamVisible: true, cloneVisible: true }
  );

  const hideAgainResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideAgainResponse.hidden, true);
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.querySelector("[data-region='cloned-mokpo']")).display
    ),
    "none"
  );

  const reappliedSplit = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(reappliedSplit.summary.jeonnamHidden, false);
  assert.equal(
    await page.evaluate(() =>
      document.querySelectorAll(".__tmgf-jeonnam-temporarily-hidden").length
    ),
    0
  );

  const finalHideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(finalHideResponse.hidden, true);

  const clearResponse = await sendContentMessage(page, { type: "TMGF_CLEAR" });
  assert.equal(clearResponse.ok, true);
  const restored = await page.evaluate(() => ({
    marks: document.querySelectorAll(
      ".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed, .__tmgf-jeonnam-temporarily-hidden"
    ).length,
    badges: document.querySelectorAll(".__tmgf-area-badge").length,
    style: Boolean(document.querySelector("#__tmgf-page-style")),
    overlay: Boolean(document.querySelector("#__tmgf-overlay-host")),
    allVisible: Array.from(document.querySelectorAll("[data-region]")).every(
      (item) => getComputedStyle(item).display !== "none"
    )
  }));
  assert.deepEqual(restored, {
    marks: 0,
    badges: 0,
    style: false,
    overlay: false,
    allVisible: true
  });
  await page.close();
  return "Generic split + reversible Jeonnam hide + dynamic restore: OK";
}

async function dropdownSmoke(context) {
  const page = await context.newPage();
  const nativeOptions = ["시/군/구 선택", ...districts, ...localities]
    .map((name) => {
      const attributes = [
        `value="${name}"`,
        name === "목포시" ? "selected" : "",
        name === "여수시" ? "hidden" : "",
        name === "순천시" ? "disabled" : ""
      ].filter(Boolean).join(" ");
      return `<option ${attributes}>${name}</option>`;
    })
    .join("");

  await page.setContent(`
    <!doctype html>
    <html lang="ko">
      <body>
        <form id="region-form">
          <label for="native-region">시/군/구</label>
          <select id="native-region" name="region">${nativeOptions}</select>
        </form>
        <div
          id="region-trigger"
          class="p-dropdown p-component"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded="false"
          tabindex="0"
        >시/군/구 선택</div>
      </body>
    </html>
  `);

  await page.evaluate(({ districtNames, localityNames }) => {
    const trigger = document.querySelector("#region-trigger");
    const renderPortal = () => {
      document.querySelector("#region-panel")?.remove();
      const panel = document.createElement("div");
      panel.id = "region-panel";
      panel.className = "p-dropdown-panel p-component";
      const wrapper = document.createElement("div");
      wrapper.className = "p-dropdown-items-wrapper";
      const list = document.createElement("ul");
      list.className = "p-dropdown-items";
      for (const name of ["시/군/구 선택", ...districtNames, ...localityNames]) {
        const option = document.createElement("li");
        option.className = "p-dropdown-item";
        option.setAttribute("role", "option");
        option.dataset.portalRegion = name;
        option.textContent = name;
        list.append(option);
      }
      wrapper.append(list);
      panel.append(wrapper);
      document.body.append(panel);
      trigger.setAttribute("aria-expanded", "true");
    };
    trigger.addEventListener("click", renderPortal);
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        renderPortal();
      }
    });
    globalThis.__RENDER_REGION_PORTAL__ = renderPortal;
  }, { districtNames: districts, localityNames: localities });

  await injectContentHarness(page);
  const splitResponse = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(splitResponse.ok, true);

  const nativeBefore = await page.evaluate(() => {
    const select = document.querySelector("#native-region");
    return {
      value: select.value,
      selectedIndex: select.selectedIndex,
      formValue: new FormData(document.querySelector("#region-form")).get("region")
    };
  });

  const hideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideResponse.ok, true);
  assert.equal(hideResponse.hidden, true);

  const nativeHidden = await page.evaluate(({ localityNames, districtNames }) => {
    const select = document.querySelector("#native-region");
    const options = Array.from(select.options);
    const byName = new Map(options.map((option) => [option.textContent.trim(), option]));
    return {
      value: select.value,
      selectedIndex: select.selectedIndex,
      formValue: new FormData(document.querySelector("#region-form")).get("region"),
      temporaryCount: options.filter((option) =>
        option.hasAttribute("data-tmgf-option-temporarily-hidden")
      ).length,
      allJeonnamHidden: localityNames.every((name) => byName.get(name)?.hidden),
      allGwangjuVisible: districtNames.every((name) => !byName.get(name)?.hidden),
      disabledNames: options.filter((option) => option.disabled).map((option) => option.textContent.trim())
    };
  }, { localityNames: localities, districtNames: districts });
  assert.deepEqual(nativeHidden, {
    ...nativeBefore,
    temporaryCount: 22,
    allJeonnamHidden: true,
    allGwangjuVisible: true,
    disabledNames: ["순천시"]
  });

  await page.evaluate(() => {
    const option = Array.from(document.querySelector("#native-region").options)
      .find((candidate) => candidate.textContent.trim() === "무안군");
    option.remove();
    globalThis.__DETACHED_NATIVE_OPTION__ = option;
  });
  const detachedShowResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: false
  });
  assert.equal(detachedShowResponse.hidden, false);
  assert.deepEqual(
    await page.evaluate(() => {
      const option = globalThis.__DETACHED_NATIVE_OPTION__;
      const state = {
        hidden: option.hidden,
        temporary: option.hasAttribute("data-tmgf-option-temporarily-hidden"),
        marked: option.matches(".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed")
      };
      document.querySelector("#native-region").append(option);
      return state;
    }),
    { hidden: false, temporary: false, marked: true }
  );
  await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  await page.evaluate(() => globalThis.__TMGF_CONTENT_STATE__.observer.disconnect());

  await page.locator("#region-trigger").click();
  await page.waitForFunction(() =>
    document.querySelectorAll("#region-panel [role='option'].__tmgf-gwangju").length === 5 &&
    document.querySelectorAll("#region-panel [role='option'].__tmgf-jeonnam-temporarily-hidden").length === 22
  );
  const portalHidden = await page.evaluate(() => {
    const options = Array.from(document.querySelectorAll("#region-panel [role='option']"));
    const neutral = document.querySelector("[data-portal-region='시/군/구 선택']");
    return {
      roleOptionCount: options.length,
      gwangjuMarked: options.filter((option) => option.classList.contains("__tmgf-gwangju")).length,
      jeonnamMarked: options.filter((option) => option.classList.contains("__tmgf-jeonnam")).length,
      jeonnamDisplayNone: options.filter(
        (option) => option.classList.contains("__tmgf-jeonnam") && getComputedStyle(option).display === "none"
      ).length,
      neutralVisible: getComputedStyle(neutral).display !== "none",
      stateHidden: globalThis.__TMGF_CONTENT_STATE__.jeonnamHidden
    };
  });
  assert.deepEqual(portalHidden, {
    roleOptionCount: 28,
    gwangjuMarked: 5,
    jeonnamMarked: 22,
    jeonnamDisplayNone: 22,
    neutralVisible: true,
    stateHidden: true
  });

  await page.evaluate(() => {
    const source = Array.from(document.querySelector("#native-region").options)
      .find((option) => option.textContent.trim() === "여수시");
    const clone = source.cloneNode(true);
    clone.dataset.clonedNative = "true";
    document.querySelector("#native-region").append(clone);
  });

  const showResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: false
  });
  assert.equal(showResponse.hidden, false);
  const restored = await page.evaluate(() => {
    const select = document.querySelector("#native-region");
    const options = Array.from(select.options);
    const clone = document.querySelector("[data-cloned-native='true']");
    return {
      value: select.value,
      selectedIndex: select.selectedIndex,
      formValue: new FormData(document.querySelector("#region-form")).get("region"),
      temporaryCount: options.filter((option) =>
        option.hasAttribute("data-tmgf-option-temporarily-hidden")
      ).length,
      originalHidden: options.find((option) => option.textContent.trim() === "여수시").hidden,
      originalDisabled: options.find((option) => option.textContent.trim() === "순천시").disabled,
      cloneOriginalHidden: clone.hidden,
      portalVisible: Array.from(document.querySelectorAll("#region-panel [role='option']"))
        .every((option) => getComputedStyle(option).display !== "none")
    };
  });
  assert.deepEqual(restored, {
    ...nativeBefore,
    temporaryCount: 0,
    originalHidden: true,
    originalDisabled: true,
    cloneOriginalHidden: true,
    portalVisible: true
  });

  await sendContentMessage(page, { type: "TMGF_SET_JEONNAM_HIDDEN", hidden: true });
  await page.evaluate(() => document.querySelector("#region-panel")?.remove());
  await page.locator("#region-trigger").press("ArrowDown");
  await page.waitForFunction(() =>
    document.querySelectorAll("#region-panel [role='option'].__tmgf-jeonnam-temporarily-hidden").length === 22
  );

  await page.evaluate(() => {
    const option = Array.from(document.querySelector("#native-region").options)
      .find((candidate) => candidate.textContent.trim() === "무안군");
    option.remove();
    globalThis.__DETACHED_BEFORE_CLEAR__ = option;
  });

  const clearResponse = await sendContentMessage(page, { type: "TMGF_CLEAR" });
  assert.equal(clearResponse.ok, true);
  assert.deepEqual(
    await page.evaluate(() => {
      const option = globalThis.__DETACHED_BEFORE_CLEAR__;
      const state = {
        hidden: option.hidden,
        temporary: option.hasAttribute("data-tmgf-option-temporarily-hidden"),
        marked: option.matches(
          ".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed, .__tmgf-jeonnam-temporarily-hidden"
        )
      };
      document.querySelector("#native-region").append(option);
      return state;
    }),
    { hidden: false, temporary: false, marked: false }
  );
  await page.evaluate(() => document.querySelector("#region-panel")?.remove());
  await page.locator("#region-trigger").click();
  await page.waitForTimeout(750);
  assert.deepEqual(
    await page.evaluate(() => ({
      marks: document.querySelectorAll(
        "#region-panel .__tmgf-gwangju, #region-panel .__tmgf-jeonnam, #region-panel .__tmgf-mixed"
      ).length,
      hidden: document.querySelectorAll(
        "#region-panel .__tmgf-jeonnam-temporarily-hidden"
      ).length,
      nativeTemporary: document.querySelectorAll(
        "#native-region [data-tmgf-option-temporarily-hidden]"
      ).length
    })),
    { marks: 0, hidden: 0, nativeTemporary: 0 }
  );

  await page.close();
  return "PrimeVue-style + native dropdown hide/restore: OK";
}

async function jusoDropdownSmoke(context) {
  const page = await context.newPage();
  await page.goto("https://www.juso.go.kr/ahu/ahuKarbSbdList", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  const sido = page.locator("#sidoList[role='combobox'][aria-label='지역선택 시/도']");
  const sgg = page.locator("#sggList[role='combobox'][aria-label='지역선택 시/군/구']");
  await sido.waitFor({ state: "visible", timeout: 60000 });
  await injectContentHarness(page);

  const splitResponse = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(splitResponse.ok, true);
  const hideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideResponse.hidden, true);

  await sido.click();
  const regionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/jusoCommon/generalSelectSggList") &&
      response.request().method() === "POST",
    { timeout: 60000 }
  );
  await page.getByRole("option", {
    name: "전남광주통합특별시",
    exact: true
  }).click();
  const regionResponse = await regionResponsePromise;
  assert.equal(regionResponse.status(), 200);
  const regionPayload = await regionResponse.json();
  assert.equal(regionPayload.length, 27);
  await page.waitForFunction(() =>
    document.querySelector("#sidoList")?.textContent.trim() === "전남광주통합특별시"
  );

  await sgg.click();
  await page.waitForFunction(() =>
    document.querySelector("#sggList")?.getAttribute("aria-expanded") === "true"
  );
  const listId = await sgg.getAttribute("aria-controls");
  assert.ok(listId, "Juso SGG listbox must expose aria-controls.");
  const listbox = page.locator(`#${listId}`);
  await listbox.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(
    (id) => document.querySelectorAll(`#${CSS.escape(id)} > li[role='option']`).length === 28,
    listId
  );
  await page.waitForFunction(
    (id) =>
      document.querySelectorAll(`#${CSS.escape(id)} > li[role='option'].__tmgf-gwangju`).length === 5 &&
      document.querySelectorAll(
        `#${CSS.escape(id)} > li[role='option'].__tmgf-jeonnam-temporarily-hidden`
      ).length === 22,
    listId
  );

  const hiddenState = await page.evaluate(
    ({ id, districtNames, localityNames }) => {
      const options = Array.from(
        document.querySelectorAll(`#${CSS.escape(id)} > li[role='option']`)
      );
      const byLabel = new Map(
        options.map((option) => [
          option.getAttribute("aria-label") || option.textContent.trim(),
          option
        ])
      );
      return {
        options: options.length,
        gwangjuMarked: districtNames.every((name) =>
          byLabel.get(name)?.classList.contains("__tmgf-gwangju")
        ),
        gwangjuVisible: districtNames.every(
          (name) => getComputedStyle(byLabel.get(name)).display !== "none"
        ),
        jeonnamMarked: localityNames.every((name) =>
          byLabel.get(name)?.classList.contains("__tmgf-jeonnam")
        ),
        jeonnamHidden: localityNames.every(
          (name) => getComputedStyle(byLabel.get(name)).display === "none"
        ),
        placeholderVisible: options
          .filter((option) => !districtNames.includes(option.getAttribute("aria-label")) &&
            !localityNames.includes(option.getAttribute("aria-label")))
          .every((option) => getComputedStyle(option).display !== "none")
      };
    },
    { id: listId, districtNames: districts, localityNames: localities }
  );
  assert.deepEqual(hiddenState, {
    options: 28,
    gwangjuMarked: true,
    gwangjuVisible: true,
    jeonnamMarked: true,
    jeonnamHidden: true,
    placeholderVisible: true
  });
  fs.mkdirSync(outputDir, { recursive: true });
  await page.screenshot({
    path: path.join(outputDir, "juso-gwangju-dropdown-filtered.png"),
    fullPage: false
  });

  const showResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: false
  });
  assert.equal(showResponse.hidden, false);
  assert.equal(
    await listbox.locator(":scope > li[role='option']").evaluateAll((options) =>
      options.every((option) => getComputedStyle(option).display !== "none")
    ),
    true
  );
  const clearResponse = await sendContentMessage(page, { type: "TMGF_CLEAR" });
  assert.equal(clearResponse.ok, true);
  await page.close();
  return "Juso live PrimeVue dropdown keeps 5 Gwangju districts: OK";
}

async function richgoSmoke(context) {
  const page = await context.newPage();
  await page.goto("https://m.richgo.ai/pc", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("[class*='UISet_RichgoMap_CompSelectBJD_AreaName']").first().waitFor({
    state: "visible",
    timeout: 60000
  });
  const closeButtons = page.getByText("닫기", { exact: true });
  if (await closeButtons.count()) {
    await closeButtons.last().click();
  }
  const trigger = page.locator("[class*='UISet_RichgoMap_CompSelectBJD_AreaName']").first();
  await trigger.evaluate((element) => {
    const target = element.parentElement || element;
    for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const EventType = eventName.startsWith("pointer") ? PointerEvent : MouseEvent;
      target.dispatchEvent(
        new EventType(eventName, {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: eventName.endsWith("down") ? 1 : 0,
          view: window
        })
      );
    }
  });
  await page.waitForTimeout(500);
  const untrustedItemCount = await page.locator(
    "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item']"
  ).count();
  if (untrustedItemCount === 0) {
    await trigger.click();
  }
  const provinceItem = page
    .locator("[class*='UISet_RichgoMap_CompSelectBJD__SD_Item']")
    .filter({ hasText: /^전남광주$/ })
    .first();
  await provinceItem.waitFor({ state: "visible", timeout: 10000 });
  await provinceItem.evaluate((element) => element.click());
  await page.waitForTimeout(500);
  const programmaticDistrictCount = await page
    .locator("[class*='UISet_RichgoMap_CompSelectBJD__SD_Item']")
    .filter({ hasText: /^(동구|서구|남구|북구|광산구)$/ })
    .count();
  if (programmaticDistrictCount < 5) {
    await provinceItem.click();
  }
  console.log(
    `Richgo programmatic picker events: triggerItems=${untrustedItemCount}, districts=${programmaticDistrictCount}`
  );
  await injectContentHarness(page);

  const response = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(response.ok, true);

  try {
    await page.waitForFunction(
      ({ districts: districtNames, localities: localityNames }) => {
        const itemSelector = "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item']";
        const items = Array.from(document.querySelectorAll(itemSelector));
        const byText = new Map(items.map((item) => [item.textContent.trim(), item]));
        return (
          districtNames.every((name) => {
            const item = items.find((candidate) =>
              candidate.textContent.trim().startsWith(name)
            );
            return item?.classList.contains("__tmgf-gwangju");
          }) &&
          localityNames.every((name) => {
            const item = items.find((candidate) =>
              candidate.textContent.trim().startsWith(name)
            );
            return item?.classList.contains("__tmgf-jeonnam");
          }) &&
          items.every((item) => getComputedStyle(item).display !== "none")
        );
      },
      { districts, localities },
      { timeout: 10000 }
    );
  } catch (error) {
    const diagnostics = await page.evaluate(({ districts: districtNames, localities: localityNames }) => {
      const wanted = new Set([...districtNames, ...localityNames, "전남광주"]);
      const matches = Array.from(document.querySelectorAll("*"))
        .filter((element) => wanted.has((element.textContent || "").trim()))
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent.trim(),
          className: typeof element.className === "string" ? element.className : "",
          area: element.dataset.tmgfArea || null
        }))
        .slice(0, 100);
      const triggerSelector = "[class*='UISet_RichgoMap_CompSelectBJD_AreaName']";
      const triggers = Array.from(document.querySelectorAll(triggerSelector)).map((element) => ({
        tag: element.tagName,
        text: element.textContent.trim(),
        className: element.className,
        outerHTML: element.outerHTML.slice(0, 1200),
        ancestors: [element.parentElement, element.parentElement?.parentElement, element.parentElement?.parentElement?.parentElement]
          .filter(Boolean)
          .map((ancestor) => ({
            tag: ancestor.tagName,
            text: (ancestor.textContent || "").trim().slice(0, 300),
            className: typeof ancestor.className === "string" ? ancestor.className : ""
          }))
      }));
      return {
        matches,
        triggers,
        state: {
          mode: globalThis.__TMGF_CONTENT_STATE__?.mode,
          provinceSelecting: Boolean(globalThis.__TMGF_CONTENT_STATE__?.richgoProvinceSelecting),
          lastSummary: globalThis.__TMGF_CONTENT_STATE__?.lastSummary
        }
      };
    }, { districts, localities });
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, "richgo-debug-failure.png"), fullPage: false });
    console.error(JSON.stringify({ response, diagnostics }, null, 2));
    throw error;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const richgoCounts = await page.evaluate(() => ({
    gwangju: document.querySelectorAll(
      "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-gwangju"
    ).length,
    jeonnam: document.querySelectorAll(
      "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-jeonnam"
    ).length,
    hidden: document.querySelectorAll(".__tmgf-hidden").length
  }));
  assert.deepEqual(richgoCounts, { gwangju: 5, jeonnam: 22, hidden: 0 });

  await page.screenshot({ path: path.join(outputDir, "richgo-split-27.png"), fullPage: false });

  const hideJeonnamResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideJeonnamResponse.hidden, true);
  const richgoHiddenState = await page.evaluate(() => ({
    markedItems: document.querySelectorAll(
      "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-gwangju, [class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-jeonnam"
    ).length,
    jeonnamHidden: document.querySelectorAll(
      "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-jeonnam-temporarily-hidden"
    ).length,
    allJeonnamNotDisplayed: Array.from(
      document.querySelectorAll(
        "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-jeonnam"
      )
    ).every((item) => getComputedStyle(item).display === "none"),
    allGwangjuVisible: Array.from(
      document.querySelectorAll(
        "[class*='UISet_RichgoMap_CompSelectBJD__SD_Item'].__tmgf-gwangju"
      )
    ).every((item) => getComputedStyle(item).display !== "none")
  }));
  assert.deepEqual(richgoHiddenState, {
    markedItems: 27,
    jeonnamHidden: 22,
    allJeonnamNotDisplayed: true,
    allGwangjuVisible: true
  });
  await page.screenshot({
    path: path.join(outputDir, "richgo-gwangju-temporary-view.png"),
    fullPage: false
  });

  const showJeonnamResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: false
  });
  assert.equal(showJeonnamResponse.hidden, false);
  assert.equal(
    await page.evaluate(() =>
      document.querySelectorAll(".__tmgf-jeonnam-temporarily-hidden").length
    ),
    0
  );

  const hideBeforeNavigation = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(hideBeforeNavigation.hidden, true);

  const navigationResponse = await sendContentMessage(page, {
    type: "TMGF_RICHGO_DISTRICT",
    district: "광산구"
  });
  assert.equal(navigationResponse.ok, true);
  await page.waitForFunction(() => {
    const areaName = document.querySelector(
      "[class*='UISet_RichgoMap_CompSelectBJD_AreaName']"
    );
    const text = areaName?.textContent || "";
    return text.includes("전남광주") && text.includes("광산구");
  }, null, { timeout: 15000 });

  const clearResponse = await sendContentMessage(page, { type: "TMGF_CLEAR" });
  assert.equal(clearResponse.ok, true);
  const restored = await page.evaluate(() => ({
    marks: document.querySelectorAll(
      ".__tmgf-gwangju, .__tmgf-jeonnam, .__tmgf-mixed, .__tmgf-jeonnam-temporarily-hidden, [data-tmgf-area]"
    ).length,
    badges: document.querySelectorAll(".__tmgf-area-badge").length,
    overlay: Boolean(document.querySelector("#__tmgf-overlay-host"))
  }));
  assert.deepEqual(restored, { marks: 0, badges: 0, overlay: false });
  await page.close();
  return "Richgo split + temporary Gwangju view + district move: OK";
}

async function vmsSmoke(context) {
  const page = await context.newPage();
  await page.goto("https://www.vms.or.kr/partspace/recruit.do", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.locator("form#searchFm").waitFor({ state: "attached", timeout: 60000 });
  await injectContentHarness(page);

  const splitResponse = await sendContentMessage(page, {
    type: "TMGF_APPLY",
    mode: "split"
  });
  assert.equal(splitResponse.ok, true);
  const vmsHideResponse = await sendContentMessage(page, {
    type: "TMGF_SET_JEONNAM_HIDDEN",
    hidden: true
  });
  assert.equal(vmsHideResponse.hidden, true);
  assert.equal(vmsHideResponse.summary.siteKind, "vms");
  assert.match(vmsHideResponse.summary.siteNote, /결과카드는.*그대로/u);
  const vmsCardState = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll("section.common ul.card-list > li, section.common li.card")
    );
    return {
      count: cards.length,
      temporarilyHidden: cards.filter((card) =>
        card.classList.contains("__tmgf-jeonnam-temporarily-hidden")
      ).length,
      allVisible: cards.every((card) => getComputedStyle(card).display !== "none")
    };
  });
  assert.ok(vmsCardState.count > 0);
  assert.equal(vmsCardState.temporarilyHidden, 0);
  assert.equal(vmsCardState.allVisible, true);
  const vmsClearResponse = await sendContentMessage(page, { type: "TMGF_CLEAR" });
  assert.equal(vmsClearResponse.ok, true);

  const originalAction = await page.locator("form#searchFm").getAttribute("action");
  await page.locator("form#searchFm").evaluate((form) => {
    form.setAttribute("action", "https://example.invalid/collect");
  });
  const blockedExternalAction = await sendContentMessage(page, {
    type: "TMGF_VMS_DISTRICT",
    code: "1221000000"
  });
  assert.equal(blockedExternalAction.ok, false);
  await page.locator("form#searchFm").evaluate((form, action) => {
    if (action === null) {
      form.removeAttribute("action");
    } else {
      form.setAttribute("action", action);
    }
  }, originalAction);

  const response = await sendContentMessage(page, {
    type: "TMGF_VMS_DISTRICT",
    code: "1221000000"
  });
  assert.equal(response.ok, true);
  await page.waitForURL(
    (url) =>
      url.pathname.endsWith("/partspace/recruit.do") &&
      url.searchParams.get("area") === "0118" &&
      url.searchParams.get("areagugun") === "1221000000",
    { timeout: 60000 }
  );
  await page.locator("form#searchFm").waitFor({ state: "attached", timeout: 60000 });
  await page.screenshot({ path: path.join(outputDir, "vms-gwangju-donggu.png"), fullPage: false });
  await page.close();
  return "VMS quick district query: OK";
}

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: true,
      viewport: { width: 1440, height: 960 }
    });
    const results = [];
    results.push(await popupSmoke(context));
    results.push(await popupWebStoreSmoke(context));
    results.push(await genericListSmoke(context));
    results.push(await dropdownSmoke(context));
    results.push(await jusoDropdownSmoke(context));
    results.push(await richgoSmoke(context));
    results.push(await vmsSmoke(context));
    console.log(results.join("\n"));
  } finally {
    await context?.close();
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(userDataDir);
    if (resolvedProfile.startsWith(`${resolvedTemp}${path.sep}gwangju-filter-live-`)) {
      fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
