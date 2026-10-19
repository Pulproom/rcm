// Synthetic setup only; never imports a personal fixture.
export function setupSourcePreview(search: string): { open: boolean; fallback: boolean; reread: boolean } {
  const params = new URLSearchParams(search);
  return { open: params.get("sheet") === "setup-sources", fallback: params.get("sources") === "fallback", reread: params.get("mode") === "reread" };
}
export const setupLore = [
  { mode: "folder", key: "people", comment: "인물" },
  { folder: "people", key: "세라, 서윤, 회장", comment: "세라 · 인물", content: "세라는 조용한 배달부다. {{user}}와 함께 항구에 산다." },
  { folder: "people", key: "오빠, 사고, 비", comment: "세라 · 과거사", content: "세라는 비 오는 날 {{user}}에게 편지를 쓴다.", alwaysActive: true },
  { folder: "people", key: "하루, 선배, 사진부", comment: "하루 선배", content: "하루는 사진부의 선배다." },
  { mode: "folder", key: "places", comment: "장소" },
  { folder: "places", key: "항구", comment: "오래된 부두", content: "부두에는 낡은 등대가 있다." },
  { mode: "folder", key: "rules", comment: "출력 규칙" },
  { folder: "rules", key: "형식", comment: "편지 형식", content: "편지의 맨 위에 날짜를 적는다." },
];
export const setupChatLore = [{ key: "축제", comment: "축제 준비 메모", content: "린과 세라는 함께 축제를 준비한다." }];
export const setupModuleLore = [{ key: "상태", comment: "상태창 모듈", content: "<status>{{user}}의 상태</status>" }];
