(function initializePopup() {
  "use strict";

  const siteLabel = document.querySelector("#site-label");
  const status = document.querySelector("#status");
  const toggleJeonnamButton = document.querySelector("#toggle-jeonnam");
  const vmsTools = document.querySelector("#vms-tools");
  const richgoTools = document.querySelector("#richgo-tools");
  let activeTab = null;
  let jeonnamHidden = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  function isSupportedPage(url) {
    try {
      const parsed = new URL(url || "");
      const isHttp = ["http:", "https:"].includes(parsed.protocol);
      const isChromeWebStore =
        parsed.hostname === "chromewebstore.google.com" ||
        (parsed.hostname === "chrome.google.com" &&
          parsed.pathname.startsWith("/webstore"));
      return isHttp && !isChromeWebStore;
    } catch {
      return false;
    }
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  }

  async function ensureContentScript(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/core.js", "src/content.js"]
    });
  }

  async function sendToPage(message) {
    if (!activeTab?.id || !isSupportedPage(activeTab.url)) {
      throw new Error("이 페이지에서는 확장프로그램을 실행할 수 없습니다.");
    }

    await ensureContentScript(activeTab.id);
    return chrome.tabs.sendMessage(activeTab.id, message);
  }

  function formatSummary(summary) {
    if (!summary) {
      return "권역 표시를 적용했습니다.";
    }

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
      return "구분할 지역 목록을 찾지 못했습니다. 화면은 변경하지 않았습니다.";
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
    return `${parts.join(" · ")}를 구분했습니다. 모든 항목은 그대로 남겼습니다.`;
  }

  function updateJeonnamButton(hidden) {
    jeonnamHidden = Boolean(hidden);
    toggleJeonnamButton.setAttribute("aria-pressed", String(jeonnamHidden));
    toggleJeonnamButton.querySelector("span").textContent = jeonnamHidden
      ? "전남권 다시 보기"
      : "전남권 잠시 숨기기";
    toggleJeonnamButton.querySelector("small").textContent = jeonnamHidden
      ? "숨겼던 전남권 항목을 모두 다시 펼칩니다"
      : "전남권만 화면에서 접고 광주권 중심으로 봅니다";
  }

  async function applySplit() {
    setStatus("현재 페이지의 지역 목록을 확인하고 있습니다.");
    try {
      const response = await sendToPage({
        type: "TMGF_APPLY",
        mode: "split"
      });
      if (response?.ok !== true) {
        throw new Error(response?.error || "권역 표시를 적용하지 못했습니다.");
      }
      updateJeonnamButton(false);
      setStatus(formatSummary(response.summary));
    } catch (error) {
      setStatus(error?.message || "권역 표시를 적용하지 못했습니다.", true);
    }
  }

  async function setJeonnamHidden(hidden) {
    setStatus(hidden ? "전남권을 잠시 숨기고 있습니다." : "전남권을 다시 펼치고 있습니다.");
    try {
      const response = await sendToPage({
        type: "TMGF_SET_JEONNAM_HIDDEN",
        hidden
      });
      if (response?.ok !== true) {
        throw new Error(response?.error || "전남권 표시를 바꾸지 못했습니다.");
      }
      updateJeonnamButton(response.hidden);
      setStatus(formatSummary(response.summary));
    } catch (error) {
      setStatus(error?.message || "전남권 표시를 바꾸지 못했습니다.", true);
    }
  }

  async function clearDisplay() {
    setStatus("권역 표시를 지우고 있습니다.");
    try {
      const response = await sendToPage({ type: "TMGF_CLEAR" });
      if (response?.ok !== true) {
        throw new Error(response?.error || "권역 표시를 지우지 못했습니다.");
      }
      updateJeonnamButton(false);
      setStatus("권역 표시를 지웠습니다. 원래 화면은 그대로 유지됩니다.");
    } catch (error) {
      setStatus(error?.message || "권역 표시를 지우지 못했습니다.", true);
    }
  }

  async function searchVmsDistrict(code, label) {
    setStatus(`VMS에서 광주 ${label} 조건을 적용합니다.`);
    try {
      const response = await sendToPage({
        type: "TMGF_VMS_DISTRICT",
        code
      });
      if (!response?.ok) {
        throw new Error(response?.error || "VMS 검색화면에서만 사용할 수 있습니다.");
      }
      setStatus(`광주 ${label} 검색 결과로 이동합니다.`);
    } catch (error) {
      setStatus(error?.message || "VMS 지역 검색을 적용하지 못했습니다.", true);
    }
  }

  async function moveRichgoDistrict(district) {
    setStatus(`리치고 지도를 광주 ${district}로 이동합니다.`);
    try {
      const response = await sendToPage({
        type: "TMGF_RICHGO_DISTRICT",
        district
      });
      if (!response?.ok) {
        throw new Error(response?.error || "리치고 지역창에서 지역을 선택하지 못했습니다.");
      }
      setStatus(`리치고 지도를 광주 ${district}로 이동했습니다.`);
    } catch (error) {
      setStatus(error?.message || "리치고 지역 이동을 완료하지 못했습니다.", true);
    }
  }

  document.querySelector("[data-mode='split']").addEventListener("click", applySplit);
  toggleJeonnamButton.addEventListener("click", () =>
    setJeonnamHidden(!jeonnamHidden)
  );
  document.querySelector("#clear-filter").addEventListener("click", clearDisplay);

  document.querySelectorAll("[data-vms-code]").forEach((button) => {
    button.addEventListener("click", () =>
      searchVmsDistrict(button.dataset.vmsCode, button.textContent.trim())
    );
  });

  document.querySelectorAll("[data-richgo-district]").forEach((button) => {
    button.addEventListener("click", () =>
      moveRichgoDistrict(button.dataset.richgoDistrict)
    );
  });

  getActiveTab()
    .then(async (tab) => {
      activeTab = tab;
      if (!tab?.url) {
        throw new Error("현재 탭을 확인할 수 없습니다.");
      }

      const url = new URL(tab.url);
      siteLabel.textContent = url.hostname;
      vmsTools.hidden = !/(^|\.)vms\.or\.kr$/i.test(url.hostname);
      richgoTools.hidden = !/(^|\.)richgo\.ai$/i.test(url.hostname);

      if (!isSupportedPage(tab.url)) {
        setStatus("Chrome 내부 페이지와 웹스토어에서는 실행할 수 없습니다.", true);
        return;
      }

      try {
        const response = await sendToPage({ type: "TMGF_STATUS" });
        if (response?.ok) {
          updateJeonnamButton(response.jeonnamHidden);
          if (response.summary) {
            setStatus(formatSummary(response.summary));
          }
        }
      } catch {
        updateJeonnamButton(false);
      }
    })
    .catch((error) =>
      setStatus(error?.message || "현재 탭을 확인하지 못했습니다.", true)
    );
})();
