import assert from "node:assert/strict";
import test from "node:test";
import {
  CompositeFileStore,
  GoogleDriveFileProvider,
} from "./google-drive-files.js";

function fixture({ files } = {}) {
  const sourceFiles = files || [{
    id: "drive-file-1",
    name: "김종수T 학습지.pdf",
    mimeType: "application/pdf",
    size: "2048",
    parents: ["folder-1"],
    capabilities: { canDownload: true },
    appProperties: { classbotAlias: "김종수T 학습지" },
    modifiedTime: "2026-07-16T00:00:00.000Z",
  }];
  const byId = new Map(sourceFiles.map((file) => [file.id, file]));
  const calls = [];
  const dependencies = {
    getCloudConnection: async (userId, provider) => {
      calls.push(["connection", userId, provider]);
      return { refresh_token: "encrypted-refresh" };
    },
    decryptToken: (value) => `decrypted:${value}`,
    getAccessToken: async (value) => {
      calls.push(["access", value]);
      return "access-token";
    },
    ensureDriveFolder: async (_accessToken, options) => {
      calls.push(["folder", options.name]);
      return { id: "folder-1", name: options.name };
    },
    listDriveFiles: async (_accessToken, options) => {
      calls.push(["list", options.folderId]);
      return sourceFiles;
    },
    getDriveFile: async (_accessToken, id) => byId.get(id),
    downloadDriveFile: async (_accessToken, id) => ({
      buffer: Buffer.from(`drive:${id}`),
      filename: byId.get(id)?.name,
      mimeType: byId.get(id)?.mimeType,
    }),
    uploadDriveFile: async (_accessToken, options) => ({
      id: "uploaded-file",
      name: options.name,
      mimeType: options.mimeType,
      size: String(options.buffer.length),
      parents: [options.folderId],
      capabilities: { canDownload: true },
      appProperties: options.appProperties,
      createdTime: "2026-07-16T01:00:00.000Z",
      modifiedTime: "2026-07-16T01:00:00.000Z",
    }),
  };
  const provider = new GoogleDriveFileProvider({
    folderName: "Quilo schedule 자료실",
    ownerUserId: "owner-user-1",
    secret: "drive-provider-test-secret",
    dependencies,
  });
  return { provider, calls, dependencies, sourceFiles };
}

test("Quilo OAuth로 전용 Drive 폴더를 만들고 PDF·이미지만 class-wide metadata로 노출한다", async () => {
  const { provider, calls } = fixture({ files: [
    {
      id: "drive-file-1",
      name: "김종수T 학습지.pdf",
      mimeType: "application/pdf",
      size: "2048",
      parents: ["folder-1"],
      capabilities: { canDownload: true },
      appProperties: { classbotAlias: "김종수T 학습지", classbotDescription: "수업 자료" },
      modifiedTime: "2026-07-16T00:00:00.000Z",
    },
    {
      id: "native-doc",
      name: "비공개 문서",
      mimeType: "application/vnd.google-apps.document",
      parents: ["folder-1"],
    },
    {
      id: "oversize-image",
      name: "큰 이미지.png",
      mimeType: "image/png",
      size: String(21 * 1024 * 1024),
      parents: ["folder-1"],
    },
  ] });

  const items = await provider.listFiles();
  assert.equal(items.length, 1);
  assert.equal(items[0].alias, "김종수T 학습지");
  assert.equal(items[0].member_id, null);
  assert.equal(items[0].provider, "google_drive");
  assert.match(items[0].id, /^gdrive_/);
  assert.equal(calls.filter(([kind]) => kind === "folder").length, 1);

  await provider.listFiles();
  assert.equal(calls.filter(([kind]) => kind === "folder").length, 1, "한 프로세스에서는 폴더를 중복 생성하지 않는다");
});

test("owner UUID가 없어도 기존 Quilo 계정의 정확한 이름으로 Drive 연결을 찾는다", async () => {
  const { dependencies, calls } = fixture();
  dependencies.findUserByName = async (name) => {
    calls.push(["owner", name]);
    return { id: "resolved-owner-user", name: "구민준" };
  };
  const provider = new GoogleDriveFileProvider({
    ownerName: "구민준",
    secret: "drive-provider-test-secret",
    dependencies,
  });

  const items = await provider.listFiles();
  assert.equal(items.length, 1);
  assert.deepEqual(calls.find(([kind]) => kind === "owner"), ["owner", "구민준"]);
  assert.deepEqual(calls.find(([kind]) => kind === "connection"), ["connection", "resolved-owner-user", "google"]);
  assert.equal(provider.ownerUserId, "resolved-owner-user");
});

test("동명이인 계정 중 Google 연결이 정확히 하나인 후보를 운영 계정으로 선택한다", async () => {
  const { dependencies, calls } = fixture();
  dependencies.findUsersByExactName = async (name) => {
    calls.push(["owners", name]);
    return [
      { id: "duplicate-without-drive", name: "구민준" },
      { id: "connected-owner", name: "구민준" },
      { id: "different-name", name: "구민준2" },
    ];
  };
  dependencies.getCloudConnection = async (userId, provider) => {
    calls.push(["connection", userId, provider]);
    return userId === "connected-owner" ? { refresh_token: "connected-refresh" } : null;
  };
  const provider = new GoogleDriveFileProvider({
    ownerName: "구민준",
    secret: "drive-provider-test-secret",
    dependencies,
  });

  const items = await provider.listFiles();
  assert.equal(items.length, 1);
  assert.equal(provider.ownerUserId, "connected-owner");
  assert.deepEqual(calls.find(([kind]) => kind === "owners"), ["owners", "구민준"]);
  assert.equal(calls.some((call) => call[0] === "connection" && call[1] === "duplicate-without-drive"), true);
  assert.equal(calls.some((call) => call[0] === "connection" && call[1] === "connected-owner"), true);
  assert.equal(calls.some((call) => call[0] === "connection" && call[1] === "different-name"), false);
});

test("동명이인 중 Google 연결 후보가 0개 또는 여러 개면 fail-closed한다", async () => {
  for (const connectedIds of [[], ["owner-1", "owner-2"]]) {
    const { dependencies } = fixture();
    dependencies.findUsersByExactName = async () => [
      { id: "owner-1", name: "구민준" },
      { id: "owner-2", name: "구민준" },
    ];
    dependencies.getCloudConnection = async (userId) => (
      connectedIds.includes(userId) ? { refresh_token: `refresh:${userId}` } : null
    );
    const provider = new GoogleDriveFileProvider({
      ownerName: "구민준",
      secret: "drive-provider-test-secret",
      dependencies,
    });
    await assert.rejects(
      () => provider.listFiles(),
      connectedIds.length ? /여러 개라 운영 계정을 자동 선택/ : /연결된 자료실 운영 계정을 찾을 수 없습니다/,
    );
    assert.equal(provider.ownerUserId, "");
  }
});

test("Drive 다운로드는 서명된 provider ID와 설정 폴더 parent를 모두 검증한다", async () => {
  const { provider, sourceFiles } = fixture();
  const [item] = await provider.listFiles();
  assert.equal((await provider.downloadFile(item.id)).toString(), "drive:drive-file-1");

  await assert.rejects(() => provider.getFile(`${item.id.slice(0, -1)}x`), /올바르지 않은 Google Drive 자료/);
  sourceFiles[0].parents = ["other-folder"];
  await assert.rejects(() => provider.downloadFile(item.id), /자료실 밖/);
});

test("반 전체 업로드는 Drive 폴더에 저장하고 개인 자료는 기존 저장소에 남긴다", async () => {
  const { provider } = fixture();
  const localCalls = [];
  const local = {
    listFiles: async () => [],
    createFile: async (input) => { localCalls.push(input); return { id: "local-private", ...input }; },
  };
  const store = new CompositeFileStore(local, provider, { logger: { warn() {} } });
  const body = Buffer.from("%PDF-1.4\n%%EOF");
  const classFile = await store.createFile({
    alias: "반 학습지",
    filename: "worksheet.pdf",
    mime_type: "application/pdf",
  }, body, "admin");
  assert.equal(classFile.provider, "google_drive");
  assert.equal(classFile.alias, "반 학습지");
  assert.equal(localCalls.length, 0);

  const privateFile = await store.createFile({
    member_id: "member-1",
    alias: "개인 피드백",
    filename: "feedback.pdf",
    mime_type: "application/pdf",
  }, body, "admin");
  assert.equal(privateFile.id, "local-private");
  assert.equal(localCalls.length, 1);
});

test("Composite file store는 Drive 장애 시 기존 Supabase 파일 목록으로 안전하게 fallback한다", async () => {
  const warnings = [];
  const local = {
    listFiles: async () => [{ id: "local-1", member_id: null, status: "active", created_at: "2026-07-15T00:00:00Z" }],
    getFile: async () => null,
    downloadFile: async () => Buffer.alloc(0),
    createFile: async () => null,
    updateFile: async () => null,
    deleteFile: async () => null,
  };
  const drive = {
    configured: true,
    isManagedId: (id) => String(id).startsWith("gdrive_"),
    listFiles: async () => { throw new Error("refresh token failed"); },
  };
  const store = new CompositeFileStore(local, drive, { logger: { warn: (value) => warnings.push(value) } });
  assert.deepEqual(await store.listFiles({ all: true }), await local.listFiles());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /refresh token failed/);
  assert.throws(() => store.deleteFile("gdrive_file.sig"), /Drive에서 직접/);
});
