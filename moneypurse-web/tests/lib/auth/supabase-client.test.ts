import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getSupabaseConfig, isSupabaseConfigured } from "../../../lib/auth/supabase-client";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

describe("supabase config", () => {
  afterEach(() => {
    delete process.env[URL_KEY];
    delete process.env[KEY_KEY];
  });

  it("is null when either env var is missing", () => {
    delete process.env[URL_KEY];
    delete process.env[KEY_KEY];
    assert.equal(getSupabaseConfig(), null);
    assert.equal(isSupabaseConfigured(), false);

    process.env[URL_KEY] = "https://ref.supabase.co";
    assert.equal(getSupabaseConfig(), null); // anon key still missing
  });

  it("returns url and anon key when both are set", () => {
    process.env[URL_KEY] = "https://ref.supabase.co";
    process.env[KEY_KEY] = "anon-key";
    assert.deepEqual(getSupabaseConfig(), { url: "https://ref.supabase.co", anonKey: "anon-key" });
    assert.equal(isSupabaseConfigured(), true);
  });
});
