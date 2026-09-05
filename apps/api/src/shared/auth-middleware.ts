import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "365d";

export interface JwtPayload {
  sub: string;
  email: string;
  nivel: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export async function hashPassword(pwd: string): Promise<string> {
  return bcrypt.hash(pwd, 12);
}

export async function verifyPassword(pwd: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pwd, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as any).cookies?.access_token;
  if (!token) { res.status(401).json({ error: "No autenticado" }); return; }
  try {
    (req as any).user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token invalido" });
  }
}
