"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const { hashPassword, verifyPassword } = require("../lib/auth");

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "ADMIN_NAME",
  "ADMIN_PASSWORD",
  "ADMIN_SYNC_PASSWORD",
  "ADMIN_ALLOW_EXISTING_PROMOTION",
];

function withAdminEnv(values) {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    SUPABASE_URL: "https://admin-bootstrap.test",
    SUPABASE_SERVICE_KEY: "service-role-test-key",
    ...values,
  });
  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

function makeClient(rows) {
  class Query {
    constructor() {
      this.operation = "select";
      this.payload = null;
      this.filters = [];
      this.ilikeFilter = null;
    }

    select() {
      return this;
    }

    ilike(column, value) {
      this.ilikeFilter = [column, String(value || "").toLowerCase()];
      return this;
    }

    limit(count) {
      let data = rows;
      if (this.ilikeFilter) {
        const [column, value] = this.ilikeFilter;
        data = data.filter(
          (row) => String(row[column] || "").toLowerCase() === value,
        );
      }
      return Promise.resolve({ data: data.slice(0, count), error: null });
    }

    update(payload) {
      this.operation = "update";
      this.payload = payload;
      return this;
    }

    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }

    async single() {
      if (this.operation !== "update") {
        return { data: null, error: new Error("unsupported test operation") };
      }
      const row = rows.find((candidate) =>
        this.filters.every(([column, value]) => candidate[column] === value),
      );
      if (!row) return { data: null, error: new Error("row not found") };
      Object.assign(row, this.payload);
      return { data: { ...row }, error: null };
    }
  }

  return {
    from(table) {
      assert.equal(table, "users");
      return new Query();
    },
  };
}

function loadSupabaseWithRows(rows) {
  const client = makeClient(rows);
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "@supabase/supabase-js") {
      return { createClient: () => client };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve("../lib/supabase");
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("admin bootstrap recovery is explicit and username-aware", async (t) => {
  await t.test("keeps an existing admin password when sync is disabled", async () => {
    const restore = withAdminEnv({
      ADMIN_NAME: "root-login",
      ADMIN_PASSWORD: "new-secret-password",
    });
    const rows = [{
      id: "admin-1",
      name: "관리자 표시 이름",
      username: "root-login",
      password_hash: hashPassword("old-secret-password"),
      is_admin: true,
    }];
    try {
      const supa = loadSupabaseWithRows(rows);
      const admin = await supa.ensureAdminFromEnv();
      assert.equal(admin.id, "admin-1");
      assert.equal(verifyPassword("old-secret-password", rows[0].password_hash), true);
      assert.equal(verifyPassword("new-secret-password", rows[0].password_hash), false);
    } finally {
      restore();
    }
  });

  await t.test("syncs an existing admin password only with the recovery flag", async () => {
    const restore = withAdminEnv({
      ADMIN_NAME: "root-login",
      ADMIN_PASSWORD: "new-secret-password",
      ADMIN_SYNC_PASSWORD: "1",
    });
    const rows = [{
      id: "admin-2",
      name: "관리자 표시 이름",
      username: "root-login",
      password_hash: hashPassword("old-secret-password"),
      is_admin: true,
    }];
    try {
      const supa = loadSupabaseWithRows(rows);
      await supa.ensureAdminFromEnv();
      assert.equal(verifyPassword("new-secret-password", rows[0].password_hash), true);
      assert.equal(verifyPassword("old-secret-password", rows[0].password_hash), false);
    } finally {
      restore();
    }
  });

  await t.test("does not promote a normal user with password sync alone", async () => {
    const restore = withAdminEnv({
      ADMIN_NAME: "existing-user",
      ADMIN_PASSWORD: "replacement-secret",
      ADMIN_SYNC_PASSWORD: "1",
    });
    const originalHash = hashPassword("original-secret");
    const rows = [{
      id: "user-1",
      name: "일반 사용자",
      username: "existing-user",
      password_hash: originalHash,
      is_admin: false,
    }];
    try {
      const supa = loadSupabaseWithRows(rows);
      await assert.rejects(
        () => supa.ensureAdminFromEnv(),
        /관리자 승격을 중단/,
      );
      assert.equal(rows[0].is_admin, false);
      assert.equal(rows[0].password_hash, originalHash);
    } finally {
      restore();
    }
  });

  await t.test("repairs a collided normal account only with both recovery flags", async () => {
    const restore = withAdminEnv({
      ADMIN_NAME: "existing-user",
      ADMIN_PASSWORD: "replacement-secret",
      ADMIN_SYNC_PASSWORD: "1",
      ADMIN_ALLOW_EXISTING_PROMOTION: "1",
    });
    const rows = [{
      id: "user-2",
      name: "일반 사용자",
      username: "existing-user",
      password_hash: hashPassword("unknown-old-secret"),
      is_admin: false,
    }];
    try {
      const supa = loadSupabaseWithRows(rows);
      const admin = await supa.ensureAdminFromEnv();
      assert.equal(admin.is_admin, true);
      assert.equal(rows[0].is_admin, true);
      assert.equal(verifyPassword("replacement-secret", rows[0].password_hash), true);
    } finally {
      restore();
    }
  });
});

test("malformed stored password hashes fail closed", () => {
  assert.equal(verifyPassword("password", "not-hex:also-not-hex"), false);
  assert.equal(
    verifyPassword("password", `${"z".repeat(32)}:${"0".repeat(128)}`),
    false,
  );
  assert.equal(
    verifyPassword("password", `${"0".repeat(32)}:${"z".repeat(128)}`),
    false,
  );
});
