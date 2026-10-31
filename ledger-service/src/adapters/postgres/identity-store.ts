import { randomUUID } from "node:crypto";
import type pg from "pg";
import { EmailAlreadyRegisteredError } from "../../identity/errors.js";
import type { Role } from "../../identity/roles.js";
import type { Customer, NewCustomer, NewUser, RefreshTokenRecord, User, UserStatus } from "../../identity/types.js";
import type { IdentityStore, UserPatch } from "../../ports/identity-store.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  customer_id: string | null;
  status: UserStatus;
  failed_login_count: number;
  locked_until: Date | null;
  must_change_password: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

interface CustomerRow {
  id: string;
  full_name: string;
  email: string;
  created_at: Date;
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

const mapUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  role: r.role,
  customerId: r.customer_id,
  status: r.status,
  failedLoginCount: r.failed_login_count,
  lockedUntil: r.locked_until,
  mustChangePassword: r.must_change_password,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const mapCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  createdAt: r.created_at,
});

const mapRefresh = (r: RefreshRow): RefreshTokenRecord => ({
  id: r.id,
  userId: r.user_id,
  familyId: r.family_id,
  tokenHash: r.token_hash,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
});

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

const PATCH_COLUMNS: Record<keyof UserPatch, string> = {
  passwordHash: "password_hash",
  status: "status",
  mustChangePassword: "must_change_password",
  failedLoginCount: "failed_login_count",
  lockedUntil: "locked_until",
  lastLoginAt: "last_login_at",
};

export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly pool: pg.Pool) {}

  async createCustomerWithUser(
    customerInput: NewCustomer,
    userInput: Omit<NewUser, "customerId" | "role">,
  ): Promise<{ customer: Customer; user: User }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const customerId = randomUUID();
      const { rows: customerRows } = await client.query<CustomerRow>(
        "INSERT INTO customers (id, full_name, email) VALUES ($1, $2, $3) RETURNING *",
        [customerId, customerInput.fullName, customerInput.email],
      );
      const { rows: userRows } = await client.query<UserRow>(
        `INSERT INTO users (id, email, password_hash, role, customer_id, must_change_password)
         VALUES ($1, $2, $3, 'customer', $4, $5) RETURNING *`,
        [randomUUID(), userInput.email, userInput.passwordHash, customerId, userInput.mustChangePassword],
      );
      await client.query("COMMIT");
      return { customer: mapCustomer(customerRows[0]!), user: mapUser(userRows[0]!) };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    } finally {
      client.release();
    }
  }

  async createCustomer(input: NewCustomer): Promise<Customer> {
    try {
      const { rows } = await this.pool.query<CustomerRow>(
        "INSERT INTO customers (id, full_name, email) VALUES ($1, $2, $3) RETURNING *",
        [randomUUID(), input.fullName, input.email],
      );
      return mapCustomer(rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }

  async createStaffUser(input: NewUser): Promise<User> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (id, email, password_hash, role, customer_id, must_change_password)
         VALUES ($1, $2, $3, $4, NULL, $5) RETURNING *`,
        [randomUUID(), input.email, input.passwordHash, input.role, input.mustChangePassword],
      );
      return mapUser(rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const { rows } = await this.pool.query<CustomerRow>("SELECT * FROM customers WHERE id = $1", [id]);
    return rows[0] ? mapCustomer(rows[0]) : null;
  }

  async listCustomers(): Promise<Customer[]> {
    const { rows } = await this.pool.query<CustomerRow>("SELECT * FROM customers ORDER BY created_at, id");
    return rows.map(mapCustomer);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users ORDER BY created_at, id");
    return rows.map(mapUser);
  }

  async updateUser(id: string, patch: UserPatch): Promise<User | null> {
    const entries = (Object.entries(patch) as [keyof UserPatch, unknown][]).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findUserById(id);
    const sets = entries.map(([key], i) => `${PATCH_COLUMNS[key]} = $${i + 2}`).join(", ");
    const { rows } = await this.pool.query<UserRow>(`UPDATE users SET ${sets} WHERE id = $1 RETURNING *`, [
      id,
      ...entries.map(([, v]) => v),
    ]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async registerLoginFailure(userId: string, now: Date, maxAttempts: number, lockMs: number): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN $3::timestamptz ELSE locked_until END
       WHERE id = $1 RETURNING *`,
      [userId, maxAttempts, new Date(now.getTime() + lockMs)],
    );
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async createRefreshToken(r: RefreshTokenRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.id, r.userId, r.familyId, r.tokenHash, r.expiresAt, r.createdAt],
    );
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const { rows } = await this.pool.query<RefreshRow>("SELECT * FROM refresh_tokens WHERE token_hash = $1", [tokenHash]);
    return rows[0] ? mapRefresh(rows[0]) : null;
  }

  async consumeRefreshToken(id: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE refresh_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL",
      [id, now],
    );
    return result.rowCount === 1;
  }

  async revokeRefreshFamily(familyId: string, now: Date): Promise<void> {
    await this.pool.query("UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL", [familyId, now]);
  }

  async revokeAllRefreshTokensForUser(userId: string, now: Date): Promise<void> {
    await this.pool.query("UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, now]);
  }
}
