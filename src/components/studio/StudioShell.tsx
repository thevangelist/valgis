import type { ReactNode } from 'react';

// One frame for every Studio mode: header on top, panel sidebar left, stage in the
// middle, optional tool sidebar right. Colours come from the brand tokens only.
export function StudioShell({ header, sidebar, sidebarOpen, onSidebarClose, rightSidebar, overlay, children }: {
  header: ReactNode;
  sidebar: ReactNode;
  sidebarOpen: boolean;
  onSidebarClose: () => void;
  rightSidebar?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {header}
      <div className="flex flex-1 overflow-hidden relative">
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-20 w-80 h-full bg-background border-r border-border flex flex-col overflow-hidden transition-transform duration-300`}>
          <div className="flex-1 overflow-y-auto p-2.5 md:p-3 space-y-2">{sidebar}</div>
        </aside>
        {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-10 md:hidden" onClick={onSidebarClose}/>}
        {overlay}
        <main className="flex-1 bg-background flex flex-col overflow-hidden">{children}</main>
        {rightSidebar && (
          <aside className="hidden md:flex flex-col w-64 bg-background border-l border-border shrink-0">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">{rightSidebar}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function InfoBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="bg-card border-b border-border px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
      <span>{left}</span>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="text-center text-muted-foreground">
      <div className="mx-auto mb-4 opacity-30 [&_svg]:mx-auto">{icon}</div>
      <p className="text-lg mb-2">{title}</p>
      <p className="text-sm">{hint}</p>
    </div>
  );
}
