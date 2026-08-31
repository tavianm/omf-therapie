import { useEffect, useId, useRef, useState } from 'react';
import { isWideLandscapePanel } from './admin-side-panel-utils';

interface AdminSidePanelProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function readDockedLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return isWideLandscapePanel(
    window.innerWidth,
    window.matchMedia('(orientation: landscape)').matches,
  );
}

export function AdminSidePanel({
  title,
  children,
  onClose,
}: AdminSidePanelProps) {
  const [isDocked, setIsDocked] = useState(readDockedLayout);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const updateLayout = () => setIsDocked(readDockedLayout());
    const orientationQuery = window.matchMedia('(orientation: landscape)');
    window.addEventListener('resize', updateLayout);
    orientationQuery.addEventListener('change', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
      orientationQuery.removeEventListener('change', updateLayout);
    };
  }, []);

  useEffect(() => {
    if (isDocked) return;

    const bodyOverflow = document.body.style.overflow;
    const documentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panelRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = documentOverflow;
    };
  }, [isDocked, onClose]);

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sage-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
      <h2
        id={titleId}
        className="font-serif text-xl font-semibold text-sage-900"
      >
        {title}
      </h2>
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-sage-600 hover:bg-sage-100 focus:outline-none focus:ring-2 focus:ring-mint-400"
        aria-label="Fermer le panneau"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );

  const content = (
    <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
      {children}
    </div>
  );

  if (isDocked) {
    return (
      <aside
        ref={panelRef}
        role="complementary"
        aria-labelledby={titleId}
        className="sticky top-24 flex max-h-[calc(100dvh-7rem)] flex-col rounded-2xl border border-sage-200 bg-white shadow-xl"
      >
        {header}
        {content}
      </aside>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-sage-950/40" aria-hidden="true" />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-0 flex min-h-0 flex-col bg-white shadow-2xl outline-none sm:inset-x-3 sm:bottom-3 sm:top-auto sm:max-h-[min(92dvh,56rem)] sm:rounded-3xl"
      >
        {header}
        {content}
      </section>
    </div>
  );
}
