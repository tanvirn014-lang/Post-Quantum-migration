import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { areaOf, landingPathFor, redirectFor } from "../../../lib/auth/routing.js";
import { hasSecurityPermission } from "../../../lib/auth/security-permissions.js";
import type { Role, SessionState } from "../../../lib/auth/session.js";

const PERMISSIONS: Record<Role, string[]> = {
  customer: ["account:read:own", "transfer:create:own"],
  operator: ["account:read:any", "account:create", "customer:create"],
  security_admin: ["user:read", "audit:read", "audit:verify"],
  auditor: ["account:read:any", "audit:read", "audit:verify"],
};

const loading: SessionState = { status: "loading", user: null, permissions: [] };
const anonymous: SessionState = { status: "anonymous", user: null, permissions: [] };
const signedIn = (role: Role, mustChangePassword = false): SessionState => ({
  status: "authenticated",
  user: { id: "u", email: `${role}@bank.test`, role, customerId: role === "customer" ? "c" : null, mustChangePassword },
  permissions: PERMISSIONS[role],
});

describe("route guards", () => {
  it("never redirects while the session is still resolving", () => {
    for (const path of ["/", "/dashboard", "/security", "/login"]) assert.strictEqual(redirectFor(path, loading), null, path);
  });

  it("sends signed-out visitors to /login from everywhere except /login", () => {
    for (const path of ["/", "/dashboard", "/security", "/security/peers", "/operations", "/change-password", "/anything"]) {
      assert.strictEqual(redirectFor(path, anonymous), "/login", path);
    }
    assert.strictEqual(redirectFor("/login", anonymous), null);
  });

  it("sends each signed-in role to its own landing page from /, /login", () => {
    assert.strictEqual(redirectFor("/", signedIn("customer")), "/dashboard");
    assert.strictEqual(redirectFor("/login", signedIn("operator")), "/operations");
    assert.strictEqual(redirectFor("/", signedIn("security_admin")), "/security");
    assert.strictEqual(redirectFor("/login", signedIn("auditor")), "/security");
  });

  it("lets a user stay in their own area", () => {
    assert.strictEqual(redirectFor("/dashboard", signedIn("customer")), null);
    assert.strictEqual(redirectFor("/operations", signedIn("operator")), null);
    assert.strictEqual(redirectFor("/security/telemetry", signedIn("auditor")), null);
    assert.strictEqual(redirectFor("/security", signedIn("security_admin")), null);
  });

  it("keeps users out of areas their permissions do not open, redirecting to their own landing page", () => {
    assert.strictEqual(redirectFor("/security", signedIn("customer")), "/dashboard");
    assert.strictEqual(redirectFor("/security/audit", signedIn("operator")), "/operations");
    assert.strictEqual(redirectFor("/operations", signedIn("auditor")), "/security");
    assert.strictEqual(redirectFor("/dashboard", signedIn("security_admin")), "/security");
    assert.strictEqual(redirectFor("/dashboard", signedIn("operator")), "/operations");
  });

  describe("forced password change", () => {
    it("traps the user on /change-password: every other route redirects there", () => {
      for (const role of ["customer", "operator", "security_admin", "auditor"] as const) {
        const s = signedIn(role, true);
        for (const path of ["/", "/dashboard", "/security", "/operations", "/login", "/security/peers"]) {
          assert.strictEqual(redirectFor(path, s), "/change-password", `${role} ${path}`);
        }
        assert.strictEqual(redirectFor("/change-password", s), null, role);
      }
    });

    it("sends a user without a pending change away from /change-password", () => {
      assert.strictEqual(redirectFor("/change-password", signedIn("customer")), "/dashboard");
    });
  });

  it("classifies paths into areas", () => {
    assert.strictEqual(areaOf("/login"), "public");
    assert.strictEqual(areaOf("/change-password"), "account");
    assert.strictEqual(areaOf("/dashboard"), "customer");
    assert.strictEqual(areaOf("/operations/x"), "operator");
    assert.strictEqual(areaOf("/security/peers"), "security");
    assert.strictEqual(areaOf("/securityx"), "account");
  });

  it("has a landing page for every role", () => {
    for (const role of ["customer", "operator", "security_admin", "auditor"] as const) assert.match(landingPathFor(role), /^\//);
  });
});

describe("security console permission hints", () => {
  it("lets only security administrators change configuration, peers and alerts", () => {
    for (const p of ["peers:manage", "config:manage", "alerts:acknowledge"] as const) {
      assert.strictEqual(hasSecurityPermission("security_admin", p), true, p);
      assert.strictEqual(hasSecurityPermission("auditor", p), false, p);
      assert.strictEqual(hasSecurityPermission("operator", p), false, p);
      assert.strictEqual(hasSecurityPermission("customer", p), false, p);
    }
  });

  it("lets both staff roles run the simulator and read benchmarks, but only security administrators generate CBOMs and run experiments", () => {
    for (const p of ["hndl:run", "benchmarks:read"] as const) {
      assert.strictEqual(hasSecurityPermission("security_admin", p), true, p);
      assert.strictEqual(hasSecurityPermission("auditor", p), true, p);
      assert.strictEqual(hasSecurityPermission("operator", p), false, p);
      assert.strictEqual(hasSecurityPermission("customer", p), false, p);
    }
    for (const p of ["cbom:generate", "experiments:run"] as const) {
      assert.strictEqual(hasSecurityPermission("security_admin", p), true, p);
      assert.strictEqual(hasSecurityPermission("auditor", p), false, p);
    }
  });

  it("denies everything when there is no role", () => {
    assert.strictEqual(hasSecurityPermission(null, "peers:manage"), false);
    assert.strictEqual(hasSecurityPermission(undefined, "telemetry:read"), false);
  });
});
