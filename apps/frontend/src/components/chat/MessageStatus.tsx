"use client";
import { Check, CheckCheck, Clock, AlertCircle } from "@/lib/bootstrap-icons";

export type Status = "pending" | "sent" | "delivered" | "read" | "failed";

export function MessageStatus({ status }: { status: Status }) {
  if (status === "read") {
    return <CheckCheck className="h-3.5 w-3.5 text-blue-400" strokeWidth={2.5} />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />;
  }
  if (status === "pending") {
    return <Clock className="h-3.5 w-3.5 opacity-50" strokeWidth={2.5} />;
  }
  if (status === "failed") {
    return <AlertCircle className="h-3.5 w-3.5 text-red-500" strokeWidth={2.5} />;
  }
  return <Check className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />;
}
