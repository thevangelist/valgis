export function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center" role="status" aria-live="polite">
      <div className="bg-card rounded-lg p-8 flex flex-col items-center gap-4 border border-border">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"/>
        <p className="text-white text-lg">{message}</p>
      </div>
    </div>
  );
}
