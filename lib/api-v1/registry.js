"use strict";

function route({ method, path, pattern, scope, summary, operationId, rewrite = null }) {
  return Object.freeze({ method, path, pattern, scope, summary, operationId, rewrite });
}

const API_V1_ROUTES = Object.freeze([
  route({
    method: "GET",
    path: "/api/v1/account",
    pattern: /^\/api\/v1\/account\/?$/,
    scope: "account:read",
    summary: "현재 Quilo 계정과 크레딧 요약",
    operationId: "getAccount",
  }),
  route({
    method: "GET",
    path: "/api/v1/jobs",
    pattern: /^\/api\/v1\/jobs\/?$/,
    scope: "jobs:read",
    summary: "최근 작업 목록",
    operationId: "listJobs",
    rewrite: () => "/api/me/jobs",
  }),
  route({
    method: "GET",
    path: "/api/v1/jobs/{id}",
    pattern: /^\/api\/v1\/jobs\/([^/]+)\/?$/,
    scope: "jobs:read",
    summary: "작업 단건 상태와 진행 정보",
    operationId: "getJob",
  }),
  route({
    method: "POST",
    path: "/api/v1/jobs/{id}/abort",
    pattern: /^\/api\/v1\/jobs\/([^/]+)\/abort\/?$/,
    scope: "jobs:write",
    summary: "진행 중인 작업 중단",
    operationId: "abortJob",
    rewrite: (match) => `/api/jobs/${match[1]}/abort`,
  }),
  route({
    method: "GET",
    path: "/api/v1/jobs/{id}/events",
    pattern: /^\/api\/v1\/jobs\/([^/]+)\/events\/?$/,
    scope: "jobs:read",
    summary: "작업 진행 SSE 스트림",
    operationId: "streamJobEvents",
    rewrite: (match) => `/api/jobs/${match[1]}/stream`,
  }),
  route({
    method: "GET",
    path: "/api/v1/jobs/{id}/download",
    pattern: /^\/api\/v1\/jobs\/([^/]+)\/download\/?$/,
    scope: "files:read",
    summary: "완료 작업 결과 다운로드",
    operationId: "downloadJob",
    rewrite: (match) => `/api/jobs/${match[1]}/download`,
  }),
  route({
    method: "GET",
    path: "/api/v1/files",
    pattern: /^\/api\/v1\/files\/?$/,
    scope: "files:read",
    summary: "24시간 파일함 목록",
    operationId: "listFiles",
    rewrite: () => "/api/me/files",
  }),
  route({
    method: "GET",
    path: "/api/v1/files/{id}/download",
    pattern: /^\/api\/v1\/files\/([^/]+)\/download\/?$/,
    scope: "files:read",
    summary: "파일함 파일 다운로드",
    operationId: "downloadFile",
    rewrite: (match) => `/api/me/files/${match[1]}/download`,
  }),
  route({
    method: "POST",
    path: "/api/v1/reports",
    pattern: /^\/api\/v1\/reports\/?$/,
    scope: "reports:write",
    summary: "보고서 생성 작업 제출",
    operationId: "createReport",
    rewrite: () => "/api/generate",
  }),
  route({
    method: "POST",
    path: "/api/v1/pdf-translations/estimate",
    pattern: /^\/api\/v1\/pdf-translations\/estimate\/?$/,
    scope: "translations:read",
    summary: "PDF 통번역 방식, 비용과 시간 분석",
    operationId: "estimatePdfTranslation",
    rewrite: () => "/api/translate-pdf/estimate",
  }),
  route({
    method: "POST",
    path: "/api/v1/pdf-translations",
    pattern: /^\/api\/v1\/pdf-translations\/?$/,
    scope: "translations:write",
    summary: "PDF 통번역 작업 제출",
    operationId: "createPdfTranslation",
    rewrite: () => "/api/translate-pdf",
  }),
  route({
    method: "POST",
    path: "/api/v1/conversions/docx-to-hwpx",
    pattern: /^\/api\/v1\/conversions\/docx-to-hwpx\/?$/,
    scope: "conversions:write",
    summary: "DOCX 문서를 HWPX로 변환",
    operationId: "convertDocxToHwpx",
    rewrite: () => "/api/convert-docx",
  }),
  route({ method: "GET", path: "/api/v1/studios/vibe/config", pattern: /^\/api\/v1\/studios\/vibe\/config\/?$/, scope: "studios:read", summary: "Vibe Coding 모델과 비용 설정", operationId: "getVibeConfig", rewrite: () => "/api/vibe/config" }),
  route({ method: "POST", path: "/api/v1/studios/vibe/generate", pattern: /^\/api\/v1\/studios\/vibe\/generate\/?$/, scope: "studios:write", summary: "Vibe Coding 프로젝트 설계 생성", operationId: "generateVibeProject", rewrite: () => "/api/vibe/generate" }),
  route({ method: "POST", path: "/api/v1/studios/vibe/refine", pattern: /^\/api\/v1\/studios\/vibe\/refine\/?$/, scope: "studios:write", summary: "Vibe Coding 프로젝트 설계 수정", operationId: "refineVibeProject", rewrite: () => "/api/vibe/refine" }),
  route({ method: "POST", path: "/api/v1/studios/vibe/image", pattern: /^\/api\/v1\/studios\/vibe\/image\/?$/, scope: "studios:write", summary: "Vibe Coding 개념 이미지 생성", operationId: "generateVibeImage", rewrite: () => "/api/vibe/image" }),
  route({ method: "GET", path: "/api/v1/studios/physics/config", pattern: /^\/api\/v1\/studios\/physics\/config\/?$/, scope: "studios:read", summary: "물리 스튜디오 모델과 스타일 설정", operationId: "getPhysicsStudioConfig", rewrite: () => "/api/physics-studio/config" }),
  route({ method: "POST", path: "/api/v1/studios/physics/generate", pattern: /^\/api\/v1\/studios\/physics\/generate\/?$/, scope: "studios:write", summary: "심화 물리 문제와 풀이 생성", operationId: "generatePhysicsProblems", rewrite: () => "/api/physics-studio/generate" }),
  route({ method: "GET", path: "/api/v1/file-chat/access", pattern: /^\/api\/v1\/file-chat\/access\/?$/, scope: "chat:write", summary: "파일 챗봇 접근 가능 여부", operationId: "getFileChatAccess", rewrite: () => "/api/filechat/access" }),
  route({ method: "POST", path: "/api/v1/file-chat/messages", pattern: /^\/api\/v1\/file-chat\/messages\/?$/, scope: "chat:write", summary: "파일과 대화 맥락으로 스트리밍 응답 생성", operationId: "createFileChatMessage", rewrite: () => "/api/filechat" }),
  route({ method: "GET", path: "/api/v1/knowledge/lab", pattern: /^\/api\/v1\/knowledge\/lab\/?$/, scope: "knowledge:read", summary: "Quilo Lab 문서 목록", operationId: "listLabEntries", rewrite: () => "/api/lab/entries" }),
  route({ method: "GET", path: "/api/v1/knowledge/lab/{id}", pattern: /^\/api\/v1\/knowledge\/lab\/([^/]+)\/?$/, scope: "knowledge:read", summary: "Quilo Lab 문서 상세", operationId: "getLabEntry", rewrite: (match) => `/api/lab/entry/${match[1]}` }),
  route({ method: "GET", path: "/api/v1/community/posts", pattern: /^\/api\/v1\/community\/posts\/?$/, scope: "community:read", summary: "커뮤니티 글 목록", operationId: "listCommunityPosts", rewrite: () => "/api/community/posts" }),
  route({ method: "POST", path: "/api/v1/community/posts", pattern: /^\/api\/v1\/community\/posts\/?$/, scope: "community:write", summary: "커뮤니티 글 작성", operationId: "createCommunityPost", rewrite: () => "/api/community/posts" }),
  route({ method: "DELETE", path: "/api/v1/community/posts/{id}", pattern: /^\/api\/v1\/community\/posts\/([^/]+)\/?$/, scope: "community:write", summary: "본인 커뮤니티 글 삭제", operationId: "deleteCommunityPost", rewrite: (match) => `/api/community/posts/${match[1]}` }),
  route({ method: "POST", path: "/api/v1/community/posts/{id}/vote", pattern: /^\/api\/v1\/community\/posts\/([^/]+)\/vote\/?$/, scope: "community:write", summary: "커뮤니티 글 공감 전환", operationId: "voteCommunityPost", rewrite: (match) => `/api/community/posts/${match[1]}/vote` }),
  route({ method: "GET", path: "/api/v1/community/posts/{id}/comments", pattern: /^\/api\/v1\/community\/posts\/([^/]+)\/comments\/?$/, scope: "community:read", summary: "커뮤니티 댓글 목록", operationId: "listCommunityComments", rewrite: (match) => `/api/community/posts/${match[1]}/comments` }),
  route({ method: "POST", path: "/api/v1/community/posts/{id}/comments", pattern: /^\/api\/v1\/community\/posts\/([^/]+)\/comments\/?$/, scope: "community:write", summary: "커뮤니티 댓글 작성", operationId: "createCommunityComment", rewrite: (match) => `/api/community/posts/${match[1]}/comments` }),
  route({ method: "DELETE", path: "/api/v1/community/comments/{id}", pattern: /^\/api\/v1\/community\/comments\/([^/]+)\/?$/, scope: "community:write", summary: "본인 커뮤니티 댓글 삭제", operationId: "deleteCommunityComment", rewrite: (match) => `/api/community/comments/${match[1]}` }),
]);

function matchApiRoute(method, pathname) {
  for (const entry of API_V1_ROUTES) {
    if (entry.method !== method) continue;
    const match = String(pathname || "").match(entry.pattern);
    if (match) return { entry, match };
  }
  return null;
}

module.exports = { API_V1_ROUTES, matchApiRoute };
