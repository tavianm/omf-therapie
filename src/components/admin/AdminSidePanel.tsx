import { useEffect, useRef } from 'react';

interface AdminSidePanelProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function AdminSidePanel({
  title,
  children,
  onClose,
}: AdminSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={title}
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[min(92dvh,56rem)] flex-col rounded-t-3xl border border-sage-200 bg-white shadow-2xl outline-none lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:rounded-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sage-200 px-4 py-3 sm:px-5">
        <h2 className="font-serif text-xl font-semibold text-sage-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-sage-600 hover:bg-sage-100 focus:outline-none focus:ring-2 focus:ring-mint-400"
          aria-label="Fermer le panneau"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
        {children}
      </div>
    </aside>
  );
}
