(function installGwangjuFilterCore(globalScope) {
  "use strict";

  if (globalScope.GwangjuFilterCore) {
    return;
  }

  const GWANGJU_DISTRICTS = Object.freeze([
    "동구",
    "서구",
    "남구",
    "북구",
    "광산구"
  ]);

  const JEONNAM_LOCALITIES = Object.freeze([
    "목포시",
    "여수시",
    "순천시",
    "나주시",
    "광양시",
    "담양군",
    "곡성군",
    "구례군",
    "고흥군",
    "보성군",
    "화순군",
    "장흥군",
    "강진군",
    "해남군",
    "영암군",
    "무안군",
    "함평군",
    "영광군",
    "장성군",
    "완도군",
    "진도군",
    "신안군"
  ]);

  const OTHER_REGION_NAMES = Object.freeze([
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "대전광역시",
    "울산광역시",
    "세종특별자치시",
    "경기도",
    "강원특별자치도",
    "강원도",
    "충청북도",
    "충청남도",
    "전북특별자치도",
    "전라북도",
    "경상북도",
    "경상남도",
    "제주특별자치도"
  ]);

  const UNIFIED_CITY_PATTERN = /(?<![가-힣])(?:전남\s*광주\s*통합\s*특별시|전남\s*광주(?=$|[^가-힣]))/u;
  const GWANGJU_METRO_PATTERN = /광주\s*광역시/;
  const GWANGJU_BADGE_PATTERN = /\[\s*광주\s*\]/;
  const JEONNAM_PROVINCE_PATTERN = /전라남도/;
  const JEONNAM_BADGE_PATTERN = /\[\s*전남\s*\]/;
  const GYEONGGI_GWANGJU_PATTERN = /경기(?:도)?\s*광주시/;
  const OTHER_REGION_SHORT_PATTERN = /(?:\[\s*(서울|부산|대구|인천|대전|울산|세종|경기|강원|충북|충남|전북|경북|경남|제주)\s*\]|(?:^|[\s,>·/()])(서울|부산|대구|인천|대전|울산|세종|경기|강원|충북|충남|전북|경북|경남|제주)(?:\s+|\s*[>·/ㆍ-]\s*)(?:[가-힣]+(?:시|군|구)))/u;

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function includesAny(text, values) {
    return values.filter((value) => text.includes(value));
  }

  function segmentKnownRegionPrefixes(text) {
    return text
      .replace(
        /(?<![가-힣])(?:전남\s*광주\s*통합\s*특별시|전남\s*광주(?=$|[^가-힣]))/gu,
        (match) => `${match} `
      )
      .replace(/광주\s*광역시/gu, (match) => `${match} `)
      .replace(/전라남도/gu, (match) => `${match} `);
  }

  function findAdministrativeNames(text, values) {
    const segmentedText = segmentKnownRegionPrefixes(text);
    return values.filter((value) => {
      const pattern = new RegExp(
        `(?:^|[^가-힣])${escapeRegExp(value)}(?=$|[^가-힣])`,
        "u"
      );
      return pattern.test(segmentedText);
    });
  }

  function hasStandaloneGwangjuRegion(text) {
    return /(?:^|[\s,>·/()])광주\s*(?:권|지역|동구|서구|남구|북구|광산구)(?:$|[\s,>·/()])/u.test(
      `${text} `
    );
  }

  function hasMixedLegacyRegion(text) {
    if (UNIFIED_CITY_PATTERN.test(text)) {
      return false;
    }

    return /(?:광주\s*(?:및|·|\/|,|ㆍ)\s*전남|전남\s*(?:및|·|\/|,|ㆍ)\s*광주)/u.test(
      text
    );
  }

  function classifyLocation(rawText, context = {}) {
    const text = normalizeText(rawText);
    const unifiedScope = Boolean(context.unifiedScope) || UNIFIED_CITY_PATTERN.test(text);
    const allowDistrictOnly = Boolean(context.allowDistrictOnly) || unifiedScope;
    const districtMatches = findAdministrativeNames(text, GWANGJU_DISTRICTS);
    const jeonnamMatches = findAdministrativeNames(text, JEONNAM_LOCALITIES);
    const otherMatches = includesAny(text, OTHER_REGION_NAMES);
    const otherShortMatch = text.match(OTHER_REGION_SHORT_PATTERN);
    const reasons = [];

    if (!text) {
      return {
        area: "unknown",
        confidence: "none",
        reasons: ["empty-text"],
        matches: []
      };
    }

    if (hasMixedLegacyRegion(text)) {
      return {
        area: "mixed",
        confidence: "strong",
        reasons: ["legacy-gwangju-jeonnam-mixed"],
        matches: ["광주", "전남"]
      };
    }

    const hasGyeonggiGwangju = GYEONGGI_GWANGJU_PATTERN.test(text);
    const hasLegacyGwangju =
      GWANGJU_METRO_PATTERN.test(text) ||
      GWANGJU_BADGE_PATTERN.test(text) ||
      hasStandaloneGwangjuRegion(text);
    const hasCurrentGwangju =
      unifiedScope &&
      districtMatches.length > 0 &&
      jeonnamMatches.length === 0 &&
      otherMatches.length === 0 &&
      !otherShortMatch;
    const hasDistrictOnlyGwangju =
      allowDistrictOnly &&
      districtMatches.length > 0 &&
      !hasGyeonggiGwangju &&
      otherMatches.length === 0 &&
      !otherShortMatch;

    const unifiedNameRemoved = text.replace(UNIFIED_CITY_PATTERN, " ");
    const hasLegacyJeonnam =
      JEONNAM_PROVINCE_PATTERN.test(text) || JEONNAM_BADGE_PATTERN.test(text);
    const hasCurrentJeonnam =
      jeonnamMatches.length > 0 ||
      (UNIFIED_CITY_PATTERN.test(text) &&
        findAdministrativeNames(unifiedNameRemoved, JEONNAM_LOCALITIES).length > 0);

    const hasGwangju =
      !hasGyeonggiGwangju &&
      (hasLegacyGwangju || hasCurrentGwangju || hasDistrictOnlyGwangju);
    const hasJeonnam = hasLegacyJeonnam || hasCurrentJeonnam;

    if (hasGyeonggiGwangju) {
      reasons.push("gyeonggi-gwangju-city");
    }
    if (hasLegacyGwangju) {
      reasons.push("legacy-gwangju-label");
    }
    if (hasCurrentGwangju) {
      reasons.push("unified-city-gwangju-district");
    }
    if (hasDistrictOnlyGwangju && !hasLegacyGwangju && !hasCurrentGwangju) {
      reasons.push("district-in-gwangju-context");
    }
    if (hasLegacyJeonnam) {
      reasons.push("legacy-jeonnam-label");
    }
    if (hasCurrentJeonnam) {
      reasons.push("jeonnam-locality");
    }

    if (hasGwangju && hasJeonnam) {
      return {
        area: "mixed",
        confidence: "strong",
        reasons,
        matches: [...districtMatches, ...jeonnamMatches]
      };
    }

    if (hasGwangju) {
      return {
        area: "gwangju",
        confidence: "strong",
        reasons,
        matches: districtMatches
      };
    }

    if (hasJeonnam) {
      return {
        area: "jeonnam",
        confidence: "strong",
        reasons,
        matches: jeonnamMatches
      };
    }

    if (hasGyeonggiGwangju || otherMatches.length > 0 || otherShortMatch) {
      return {
        area: "other",
        confidence: "strong",
        reasons: reasons.length > 0 ? reasons : ["other-province"],
        matches: hasGyeonggiGwangju
          ? ["경기도 광주시"]
          : otherMatches.length > 0
            ? otherMatches
            : [otherShortMatch[1] || otherShortMatch[2]]
      };
    }

    if (districtMatches.length > 0) {
      return {
        area: "unknown",
        confidence: "weak",
        reasons: ["ambiguous-district-name"],
        matches: districtMatches
      };
    }

    if (/광주/u.test(text)) {
      return {
        area: "unknown",
        confidence: "weak",
        reasons: ["ambiguous-gwangju-text"],
        matches: ["광주"]
      };
    }

    return {
      area: "unknown",
      confidence: "none",
      reasons: ["no-location-signal"],
      matches: []
    };
  }

  function splitMark(classification) {
    const area = classification?.area;
    return ["gwangju", "jeonnam", "mixed"].includes(area) ? area : null;
  }

  function hasLocationSignal(rawText, context = {}) {
    const classification = classifyLocation(rawText, context);
    return classification.area !== "unknown" || classification.confidence === "weak";
  }

  function isLikelyGwangjuRegionCode(rawValue) {
    const value = normalizeText(rawValue).replace(/\D/g, "");
    return /^29\d{8}$/.test(value) || /^29\d{3,}$/.test(value);
  }

  globalScope.GwangjuFilterCore = Object.freeze({
    GWANGJU_DISTRICTS,
    JEONNAM_LOCALITIES,
    OTHER_REGION_NAMES,
    UNIFIED_CITY_PATTERN,
    classifyLocation,
    escapeRegExp,
    hasLocationSignal,
    isLikelyGwangjuRegionCode,
    normalizeText,
    splitMark
  });
})(globalThis);
