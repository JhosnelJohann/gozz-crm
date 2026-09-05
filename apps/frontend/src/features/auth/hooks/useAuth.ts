"use client";
import { useState } from "react";
import type { LoginRequest, LoginResponse } from "@gozz/shared-types";
import { apiPost, ApiError } from "@/lib/api-client";

export function useAuth() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  async function login(credentials: LoginRequest): Promise<LoginResponse> {
    setLoggingIn(true);
    try {
      return await apiPost<LoginResponse>("/api/auth/login", credentials);
    } finally {
      setLoggingIn(false);
    }
  }

  async function forgotPassword(email: string): Promise<void> {
    setSendingCode(true);
    try {
      await apiPost<{ ok: true }>("/api/auth/forgot", { email });
    } finally {
      setSendingCode(false);
    }
  }

  async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    setResettingPassword(true);
    try {
      await apiPost<{ ok: true }>("/api/auth/reset", { email, code, new_password: newPassword });
    } finally {
      setResettingPassword(false);
    }
  }

  return { login, loggingIn, forgotPassword, sendingCode, resetPassword, resettingPassword };
}

export { ApiError };
