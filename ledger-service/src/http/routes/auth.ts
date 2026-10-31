import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Session } from "../../app/identity-service.js";
import { InvalidRefreshTokenError, OriginNotAllowedError } from "../../identity/errors.js";
import { permissionsFor } from "../../identity/roles.js";
import type { RouteDeps } from "../deps.js";
import { requestContext, requireUser } from "../guards.js";
import { emailSchema } from "../schemas.js";

const REFRESH_COOKIE = "pq_refresh";

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

export function registerAuthRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { identity, tokens, config, guards } = deps;

  function setRefreshCookie(reply: FastifyReply, session: Session): void {
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      // Same-site (not cross-site) requests from other localhost ports are still "same site",
      // so SameSite alone is not enough; originGuard below is the CSRF check for cookie routes.
      sameSite: "strict",
      path: "/auth",
      expires: session.refreshExpiresAt,
    });
  }

  function sessionBody(session: Session) {
    return {
      accessToken: session.accessToken,
      tokenType: "Bearer" as const,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  /** Cookie-authenticated endpoints must come from an allow-listed origin. Browsers always
   *  attach Origin to cross-origin POSTs; clients that send none (curl, servers) cannot be
   *  driven by a victim's browser, so they pass. */
  function originGuard(req: FastifyRequest): void {
    const origin = req.headers.origin;
    if (typeof origin === "string" && !config.corsOrigins.includes(origin)) throw new OriginNotAllowedError();
  }

  return async (app) => {
    app.get("/.well-known/jwks.json", async () => tokens.jwks());

    app.post(
      "/auth/login",
      { config: { rateLimit: { max: config.loginRateLimitMax, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const body = loginSchema.parse(req.body);
        const session = await identity.login(body.email, body.password, requestContext(req));
        setRefreshCookie(reply, session);
        void reply.header("cache-control", "no-store").send(sessionBody(session));
      },
    );

    app.post("/auth/refresh", async (req, reply) => {
      originGuard(req);
      const raw = req.cookies[REFRESH_COOKIE];
      if (!raw) throw new InvalidRefreshTokenError();
      try {
        const session = await identity.refresh(raw, requestContext(req));
        setRefreshCookie(reply, session);
        void reply.header("cache-control", "no-store").send(sessionBody(session));
      } catch (err) {
        void reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
        throw err;
      }
    });

    app.post("/auth/logout", async (req, reply) => {
      originGuard(req);
      await identity.logout(req.cookies[REFRESH_COOKIE], requestContext(req));
      void reply.clearCookie(REFRESH_COOKIE, { path: "/auth" }).status(204).send();
    });

    app.post(
      "/auth/change-password",
      {
        preHandler: [guards.authenticate],
        config: { allowWhilePasswordChangeRequired: true, rateLimit: { max: config.loginRateLimitMax, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const body = changePasswordSchema.parse(req.body);
        const session = await identity.changePassword(user.id, body.currentPassword, body.newPassword, requestContext(req));
        setRefreshCookie(reply, session);
        void reply.header("cache-control", "no-store").send(sessionBody(session));
      },
    );

    app.get(
      "/auth/me",
      { preHandler: [guards.authenticate], config: { allowWhilePasswordChangeRequired: true } },
      async (req) => {
        const user = requireUser(req);
        return {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            customerId: user.customerId,
            mustChangePassword: user.mustChangePassword,
          },
          permissions: permissionsFor(user.role),
        };
      },
    );
  };
}
