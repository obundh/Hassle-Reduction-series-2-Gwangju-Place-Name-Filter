import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/core.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "src/core.js" });
const core = context.GwangjuFilterCore;

test("core is installed in an isolated context", () => {
  assert.ok(core);
  assert.equal(typeof core.classifyLocation, "function");
  assert.equal(core.GWANGJU_DISTRICTS.length, 5);
  assert.equal(core.JEONNAM_LOCALITIES.length, 22);
});

for (const district of ["동구", "서구", "남구", "북구", "광산구"]) {
  test(`legacy Gwangju address is classified: ${district}`, () => {
    assert.equal(core.classifyLocation(`광주광역시 ${district}`).area, "gwangju");
  });

  test(`unified-city Gwangju address is classified: ${district}`, () => {
    assert.equal(
      core.classifyLocation(`전남광주통합특별시 ${district}`).area,
      "gwangju"
    );
  });
}

for (const locality of ["목포시", "여수시", "순천시", "나주시", "광양시", "화순군", "신안군"]) {
  test(`former Jeonnam locality is classified: ${locality}`, () => {
    assert.equal(
      core.classifyLocation(`전남광주통합특별시 ${locality}`).area,
      "jeonnam"
    );
  });
}

test("VMS legacy Gwangju badge is strong evidence", () => {
  assert.equal(
    core.classifyLocation("봉사지역 [광주] 광주광역시 서구").area,
    "gwangju"
  );
});

test("VMS legacy Jeonnam badge is strong evidence", () => {
  assert.equal(core.classifyLocation("봉사지역 [전남] 전라남도 무안군").area, "jeonnam");
});

test("bare repeated district names remain uncertain without regional context", () => {
  for (const district of ["동구", "서구", "남구", "북구", "광산구"]) {
    const result = core.classifyLocation(district);
    assert.equal(result.area, "unknown");
    assert.equal(result.confidence, "weak");
  }
});

test("larger district names never match a Gwangju district by substring", () => {
  const context = { unifiedScope: true, allowDistrictOnly: true };
  for (const district of ["강남구", "강서구", "강동구", "강북구", "성북구"]) {
    assert.equal(core.classifyLocation(district, context).area, "unknown", district);
  }
});

test("concatenated official Gwangju prefixes still preserve district boundaries", () => {
  assert.equal(core.classifyLocation("광주광역시북구").area, "gwangju");
  assert.equal(core.classifyLocation("전남광주통합특별시광산구").area, "gwangju");
});

test("short unified-city labels classify former areas without matching organization names", () => {
  assert.equal(core.classifyLocation("전남광주 > 북구").area, "gwangju");
  assert.equal(core.classifyLocation("[전남광주] 목포시").area, "jeonnam");
  assert.equal(core.classifyLocation("전남광주본부 남구").area, "unknown");
});

test("district names are Gwangju only inside confirmed unified-city context", () => {
  assert.equal(
    core.classifyLocation("동구", { unifiedScope: true, allowDistrictOnly: true }).area,
    "gwangju"
  );
});

test("Gyeonggi Gwangju is not confused with Gwangju metropolitan area", () => {
  assert.equal(core.classifyLocation("경기도 광주시 오포읍").area, "other");
});

test("other provinces are classified as outside the target area", () => {
  assert.equal(core.classifyLocation("부산광역시 동구").area, "other");
  assert.equal(core.classifyLocation("대구광역시 서구").area, "other");
});

test("page-wide unified-city context never overrides an explicit other province", () => {
  const context = { unifiedScope: true, allowDistrictOnly: true };
  for (const address of [
    "부산광역시 남구",
    "대구광역시 서구",
    "인천광역시 동구",
    "대전광역시 서구",
    "울산광역시 북구"
  ]) {
    assert.equal(core.classifyLocation(address, context).area, "other", address);
  }
});

test("abbreviated province labels also override unified-city context", () => {
  const context = { unifiedScope: true, allowDistrictOnly: true };
  for (const address of [
    "부산 남구",
    "대구 서구",
    "인천 동구",
    "대전 서구",
    "울산 북구",
    "[부산] 동구 봉사",
    "[서울] 복지관 봉사"
  ]) {
    assert.equal(core.classifyLocation(address, context).area, "other", address);
  }
});

test("abbreviated province breadcrumbs accept common separators", () => {
  const context = { unifiedScope: true, allowDistrictOnly: true };
  for (const address of ["부산·남구", "대구>서구", "인천/동구", "울산-북구"]) {
    assert.equal(core.classifyLocation(address, context).area, "other", address);
  }
});

test("unified-city name alone is not enough to choose a former area", () => {
  assert.equal(core.classifyLocation("전남광주통합특별시").area, "unknown");
});

test("organization names do not become addresses", () => {
  assert.equal(core.classifyLocation("전남대학교병원").area, "unknown");
  assert.equal(core.classifyLocation("아름다운가게 광주전남본부").area, "unknown");
});

test("explicit Gwangju and Jeonnam coverage stays mixed", () => {
  assert.equal(core.classifyLocation("광주 및 전남 지역 야외 봉사").area, "mixed");
});

test("split marks never target other or unknown regions", () => {
  assert.equal(core.splitMark({ area: "gwangju" }), "gwangju");
  assert.equal(core.splitMark({ area: "jeonnam" }), "jeonnam");
  assert.equal(core.splitMark({ area: "mixed" }), "mixed");
  assert.equal(core.splitMark({ area: "other" }), null);
  assert.equal(core.splitMark({ area: "unknown" }), null);
});

test("Gwangju legal-dong codes can be recognized without treating arbitrary numbers as regions", () => {
  assert.equal(core.isLikelyGwangjuRegionCode("2920016200"), true);
  assert.equal(core.isLikelyGwangjuRegionCode("1233000000"), false);
  assert.equal(core.isLikelyGwangjuRegionCode("29"), false);
});
