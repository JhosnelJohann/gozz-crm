"use client";
import { Check, CheckCheck } from "@/lib/bootstrap-icons";

export type Status = "sent" | "delivered" | "read";

export function MessageStatus({ status }: { status: Status }) {
  if (status === "read") {
    return <CheckCheck className="h-3.5 w-3.5 text-blue-400" strokeWidth={2.5} />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />;
  }
  return <Check className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />;
}
