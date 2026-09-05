"use client";
import { Mail, MailOpen, CheckCheck } from "@/lib/bootstrap-icons";
import { EmailQuickSearch } from "./EmailQuickSearch";
import { AuroraBackground } from "@/components/magic/AuroraBackground";
import { NumberTicker } from "@/components/magic/NumberTicker";

interface Props {
  total: number;
  unread: number;
  selectedCount: number;
  allChecked: boolean;
  onToggleAll: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onMarkAllRead: () => void;
  buzonId: string | null;
  folder: string;
  onOpenEmail: (id: string) => void;
}

export function EmailActionsBar({
  total, unread, selectedCount, allChecked,
  onToggleAll, onMarkRead, onMarkUnread, onMarkAllRead,
  buzonId, folder, onOpenEmail,
}: Props) {
  return (
    <div className="relative border-b border-black/5 dark:border-white/10">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <AuroraBackground intensity={0.35} />
      </div>
      <div className="relative px-5 py-3 flex items-center gap-3 text-xs flex-wrap bg-white/50 dark:bg-white/[0.02] backdrop-blur-xl">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={onToggleAll}
            className="h-3.5 w-3.5 rounded accent-brand-orange cursor-pointer"
          />
          <span className="text-neutral-500 text-[11px] font-ui uppercase tracking-wider">{allChecked ? "Deselec." : "Todos"}</span>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500 text-[11px]">Correos electrónicos:</span>
          <span
            className={`inline-flex items-center justify-center min-w-[28px] rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums transition ${
              unread > 0
                ? "bg-brand-red text-white shadow-[0_0_12px_rgba(229,57,53,0.5)]"
                : "bg-black/5 dark:bg-white/10 text-neutral-500"
            }`}
          >
            <NumberTicker value={unread} duration={800} />
          </span>
          {total > 0 && (
            <span className="text-[10px] text-neutral-400 font-ui uppercase tracking-wider ml-1">
              / {total}
            </span>
          )}
        </div>

        {selectedCount > 0 && (
          <>
            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
            <span className="text-[11px] text-brand-orange font-bold font-ui uppercase tracking-wider">
              {selectedCount} seleccionado{selectedCount > 1 ? "s" : ""}
            </span>
            <button
              onClick={onMarkUnread}
              className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[11px] text-neutral-700 dark:text-neutral-200 font-ui uppercase tracking-wider font-bold flex items-center gap-1.5 transition"
            >
              <Mail className="h-3 w-3" strokeWidth={1.8} /> No leído
            </button>
            <button
              onClick={onMarkRead}
              className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[11px] text-neutral-700 dark:text-neutral-200 font-ui uppercase tracking-wider font-bold flex items-center gap-1.5 transition"
            >
              <MailOpen className="h-3 w-3" strokeWidth={1.8} /> Leído
            </button>
          </>
        )}

        <div className="flex-1" />

        <EmailQuickSearch buzonId={buzonId} folder={folder} onOpenEmail={onOpenEmail} />

        <button
          onClick={onMarkAllRead}
          disabled={unread === 0}
          className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-neutral-700 dark:text-neutral-200 font-ui uppercase tracking-wider font-bold flex items-center gap-1.5 transition"
        >
          <CheckCheck className="h-3 w-3" strokeWidth={1.8} /> Todo leído
        </button>
      </div>
    </div>
  );
}
