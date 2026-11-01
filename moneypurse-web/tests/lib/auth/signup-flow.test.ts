import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { SignupController, type SignupGateway, type SignupSession } from "../../../lib/auth/signup-flow";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeGateway implements SignupGateway {
  requestCalls: { email: string; password: string; fullName: string }[] = [];
  verifyCalls: { email: string; code: string }[] = [];
  resendCalls: string[] = [];
  nextRequest: Deferred<void> | null = null;
  nextVerify: Deferred<SignupSession> | null = null;

  async requestSignup(input: { email: string; password: string; fullName: string }): Promise<void> {
    this.requestCalls.push(input);
    if (this.nextRequest) return this.nextRequest.promise;
  }
  async verifyCode(input: { email: string; code: string }): Promise<SignupSession> {
    this.verifyCalls.push(input);
    if (this.nextVerify) return this.nextVerify.promise;
    return { accessToken: "access-" + input.code, refreshToken: "refresh" };
  }
  async resendCode(email: string): Promise<void> {
    this.resendCalls.push(email);
  }
}

const VALID = { fullName: "Dana Doe", email: "Dana@Example.com ", password: "s3cret-passphrase" };

describe("SignupController", () => {
  let gateway: FakeGateway;
  let controller: SignupController;
  beforeEach(() => {
    gateway = new FakeGateway();
    controller = new SignupController(gateway);
  });

  it("starts in the collecting step with no error", () => {
    assert.equal(controller.getState().step, "collecting");
    assert.equal(controller.getState().error, null);
  });

  it("rejects an invalid email without calling the gateway", async () => {
    await controller.submitDetails({ fullName: "Dana", email: "not-an-email", password: "s3cret-passphrase" });
    assert.equal(controller.getState().step, "collecting");
    assert.match(controller.getState().error ?? "", /email/i);
    assert.equal(gateway.requestCalls.length, 0);
  });

  it("rejects a password shorter than 8 characters without calling the gateway", async () => {
    await controller.submitDetails({ fullName: "Dana", email: "dana@example.com", password: "short" });
    assert.equal(controller.getState().step, "collecting");
    assert.match(controller.getState().error ?? "", /8/);
    assert.equal(gateway.requestCalls.length, 0);
  });

  it("rejects a blank full name", async () => {
    await controller.submitDetails({ fullName: "   ", email: "dana@example.com", password: "s3cret-passphrase" });
    assert.equal(controller.getState().step, "collecting");
    assert.equal(gateway.requestCalls.length, 0);
  });

  it("sends the code with a normalized email and advances to awaiting-code", async () => {
    gateway.nextRequest = deferred();
    const pending = controller.submitDetails(VALID);
    assert.equal(controller.getState().step, "sending-code"); // transient state is observable
    gateway.nextRequest.resolve();
    await pending;

    assert.equal(controller.getState().step, "awaiting-code");
    assert.equal(controller.getState().email, "dana@example.com"); // trimmed + lower-cased
    assert.equal(gateway.requestCalls[0]!.email, "dana@example.com");
    assert.equal(gateway.requestCalls[0]!.fullName, "Dana Doe");
    assert.equal(controller.getState().error, null);
  });

  it("returns to collecting with an error when sending the code fails", async () => {
    gateway.nextRequest = deferred();
    const pending = controller.submitDetails(VALID);
    gateway.nextRequest.reject(new Error("Email rate limit exceeded"));
    await pending;
    assert.equal(controller.getState().step, "collecting");
    assert.match(controller.getState().error ?? "", /rate limit/i);
  });

  it("rejects a code that is not six digits without calling the gateway", async () => {
    await controller.submitDetails(VALID);
    await controller.submitCode("12a4");
    assert.equal(controller.getState().step, "awaiting-code");
    assert.equal(gateway.verifyCalls.length, 0);
    assert.match(controller.getState().error ?? "", /code/i);
  });

  it("verifies a valid code and reaches done with a session", async () => {
    await controller.submitDetails(VALID);
    gateway.nextVerify = deferred();
    const pending = controller.submitCode("123456");
    assert.equal(controller.getState().step, "verifying");
    gateway.nextVerify.resolve({ accessToken: "the-access-token", refreshToken: "the-refresh" });
    await pending;

    assert.equal(controller.getState().step, "done");
    assert.equal(controller.getState().session?.accessToken, "the-access-token");
    assert.equal(gateway.verifyCalls[0]!.email, "dana@example.com");
    assert.equal(gateway.verifyCalls[0]!.code, "123456");
  });

  it("returns to awaiting-code with an error when verification fails", async () => {
    await controller.submitDetails(VALID);
    gateway.nextVerify = deferred();
    const pending = controller.submitCode("000000");
    gateway.nextVerify.reject(new Error("Token has expired or is invalid"));
    await pending;
    assert.equal(controller.getState().step, "awaiting-code");
    assert.match(controller.getState().error ?? "", /expired|invalid/i);
    assert.equal(controller.getState().session, null);
  });

  it("resends the code for the current email", async () => {
    await controller.submitDetails(VALID);
    await controller.resend();
    assert.deepEqual(gateway.resendCalls, ["dana@example.com"]);
  });

  it("notifies subscribers on state change", async () => {
    let count = 0;
    const unsub = controller.subscribe(() => count++);
    await controller.submitDetails(VALID);
    assert.ok(count > 0);
    unsub();
    const before = count;
    await controller.resend();
    assert.equal(count, before); // no notifications after unsubscribe
  });
});
