import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert.equal(manifest.manifest_version, 3, "Manifest V3가 필요합니다.");
assert.deepEqual(
  [...manifest.permissions].sort(),
  ["activeTab", "scripting"].sort(),
  "권한은 activeTab, scripting만 허용합니다."
);
assert.equal(manifest.host_permissions, undefined, "상시 사이트 권한을 포함하면 안 됩니다.");
assert.equal(
  manifest.optional_host_permissions,
  undefined,
  "현재 버전은 선택적 사이트 권한도 사용하지 않습니다."
);

const requiredFiles = [
  manifest.action.default_popup,
  "popup/popup.css",
  "popup/popup.js",
  "src/core.js",
  "src/content.js"
];
await Promise.all(requiredFiles.map((file) => access(path.join(projectRoot, file))));

const sourceFiles = ["popup/popup.js", "src/core.js", "src/content.js"];
const source = (
  await Promise.all(sourceFiles.map((file) => readFile(path.join(projectRoot, file), "utf8")))
).join("\n");
const popupHtml = await readFile(path.join(projectRoot, "popup/popup.html"), "utf8");
const popupSource = await readFile(path.join(projectRoot, "popup/popup.js"), "utf8");
const contentSource = await readFile(path.join(projectRoot, "src/content.js"), "utf8");

assert.match(popupHtml, /data-mode="split"/, "기본 권역 구분 버튼이 필요합니다.");
assert.doesNotMatch(
  popupHtml,
  /data-mode="(?:gwangju|jeonnam)"|strict-mode/,
  "광주권·전남권 영구 필터 모드는 제공하지 않습니다."
);
assert.match(
  popupHtml,
  /id="toggle-jeonnam"[^>]*aria-pressed="false"/s,
  "전남권 임시 숨김·복원 토글이 필요합니다."
);
assert.match(
  popupSource,
  /chromewebstore\.google\.com/,
  "Chrome 웹스토어는 주입 전에 지원 대상에서 제외해야 합니다."
);
assert.doesNotMatch(
  contentSource,
  /__tmgf-hidden/,
  "기존 영구 숨김 클래스가 남으면 안 됩니다."
);
const displayNoneRules = contentSource.match(/display\s*:\s*none\s*!important/g) || [];
assert.equal(
  displayNoneRules.length,
  1,
  "display:none은 전남권 임시 숨김 규칙 하나에만 허용합니다."
);
assert.match(
  contentSource,
  /\.\$\{JEONNAM_CLASS\}\.\$\{TEMP_HIDDEN_CLASS\}\s*\{\s*display\s*:\s*none\s*!important/s,
  "전남권과 임시 숨김 클래스가 함께 있을 때만 숨겨야 합니다."
);
assert.match(
  contentSource,
  /data-tmgf-option-temporarily-hidden/,
  "네이티브 option 원상복구 표식이 필요합니다."
);
assert.doesNotMatch(
  contentSource,
  /\.disabled\s*=/,
  "필터가 option의 disabled 상태나 폼 전송 의미를 바꾸면 안 됩니다."
);
assert.match(
  contentSource,
  /\["click",\s*"change",\s*"keydown"\]/,
  "늦게 열리는 드롭다운을 클릭·변경·키보드 상호작용 뒤 다시 확인해야 합니다."
);

for (const forbidden of [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/
]) {
  assert.equal(
    forbidden.test(source),
    false,
    `외부 전송 또는 동적 코드 실행 패턴이 감지되었습니다: ${forbidden}`
  );
}

console.log("Manifest/privacy validation: OK");
