#!/usr/bin/env node
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { DATABASE_URL, NEW_USER_EMAIL, NEW_USER_NAME, NEW_USER_PASSWORD, NEW_USER_NIVEL } = process.env;

if (!DATABASE_URL || !NEW_USER_EMAIL || !NEW_USER_NAME || !NEW_USER_PASSWORD) {
  console.error("Missing env vars: NEW_USER_EMAIL, NEW_USER_NAME, NEW_USER_PASSWORD required");
  process.exit(1);
}

const nivel = NEW_USER_NIVEL || "usuario";
if (!["super_admin", "admin", "usuario"].includes(nivel)) {
  console.error(`Invalid NEW_USER_NIVEL: ${nivel}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
  const hash = await bcrypt.hash(NEW_USER_PASSWORD, 12);
  const { rows } = await pool.query(
    "SELECT id FROM gozz.users WHERE email = $1",
    [NEW_USER_EMAIL.toLowerCase()]
  );

  if (rows.length > 0) {
    console.log(`User already exists (id=${rows[0].id}). Updating password hash and nivel_acceso...`);
    await pool.query(
      "UPDATE gozz.users SET password_hash = $1, nombre = $2, nivel_acceso = $3, activo = true WHERE email = $4",
      [hash, NEW_USER_NAME, nivel, NEW_USER_EMAIL.toLowerCase()]
    );
  } else {
    await pool.query(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, inmutable, activo, posiciones)
       VALUES ($1, $2, $3, $4, false, true, '[]'::jsonb)`,
      [NEW_USER_EMAIL.toLowerCase(), hash, NEW_USER_NAME, nivel]
    );
    console.log(`User created: ${NEW_USER_EMAIL} (nivel_acceso=${nivel})`);
  }
} catch (err) {
  console.error("Create user failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
