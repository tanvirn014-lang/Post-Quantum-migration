import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ROLES } from "../../identity/roles.js";
import type { Customer } from "../../identity/types.js";
import type { RouteDeps } from "../deps.js";
import { requestContext, requireUser } from "../guards.js";
import { emailSchema } from "../schemas.js";

const createCustomerSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const createStaffSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES.filter((r) => r !== "customer") as [string, ...string[]]),
  password: z.string().min(1).max(256),
});

const userIdParams = z.object({ id: z.uuid() });

function toCustomerDTO(c: Customer) {
  return { id: c.id, fullName: c.fullName, email: c.email, createdAt: c.createdAt.toISOString() };
}

/** Customer onboarding and staff user administration. */
export function registerPeopleRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { identity, guards } = deps;

  return async (app) => {
    app.post("/customers", { preHandler: [guards.authenticate, guards.can("customer:create")] }, async (req, reply) => {
      const body = createCustomerSchema.parse(req.body);
      const { customer, user } = await identity.createCustomerWithUser(requireUser(req), body, requestContext(req));
      void reply.status(201).send({ customer: toCustomerDTO(customer), user });
    });

    app.get("/customers", { preHandler: [guards.authenticate, guards.can("account:read:any")] }, async () => {
      return (await identity.listCustomers()).map(toCustomerDTO);
    });

    app.get("/users", { preHandler: [guards.authenticate, guards.can("user:read")] }, async () => identity.listUsers());

    app.post("/users", { preHandler: [guards.authenticate, guards.can("user:create:staff")] }, async (req, reply) => {
      const body = createStaffSchema.parse(req.body);
      const user = await identity.createStaffUser(requireUser(req), { ...body, role: body.role as (typeof ROLES)[number] }, requestContext(req));
      void reply.status(201).send(user);
    });

    for (const [action, status] of [
      ["disable", "disabled"],
      ["enable", "active"],
    ] as const) {
      app.post(`/users/:id/${action}`, { preHandler: [guards.authenticate, guards.can("user:disable")] }, async (req) => {
        const { id } = userIdParams.parse(req.params);
        return identity.setUserStatus(requireUser(req), id, status, requestContext(req));
      });
    }
  };
}
