#!/usr/bin/env node
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { DATABASE_URL, SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, SUPER_ADMIN_PASSWORD } = process.env;

if (!DATABASE_URL || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_NAME || !SUPER_ADMIN_PASSWORD) {
  console.error("Missing env vars");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
  const hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  const { rows } = await pool.query(
    "SELECT id FROM gozz.users WHERE email = $1",
    [SUPER_ADMIN_EMAIL.toLowerCase()]
  );

  if (rows.length > 0) {
    console.log(`Super admin already exists (id=${rows[0].id}). Updating password hash...`);
    await pool.query(
      "UPDATE gozz.users SET password_hash = $1, nombre = $2 WHERE email = $3",
      [hash, SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL.toLowerCase()]
    );
  } else {
    await pool.query(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, inmutable, activo, posiciones)
       VALUES ($1, $2, $3, 'super_admin', true, true, '["Manager General"]'::jsonb)`,
      [SUPER_ADMIN_EMAIL.toLowerCase(), hash, SUPER_ADMIN_NAME]
    );
    console.log(`Super admin created: ${SUPER_ADMIN_EMAIL}`);
  }
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
