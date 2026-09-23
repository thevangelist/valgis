import { Monitor, Camera, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BASE = import.meta.env.BASE_URL;

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

export default function Landing({
  onDesktop,
  onCamera,
  onAstro,
}: {
  onDesktop: () => void;
  onCamera: () => void;
  onAstro: () => void;
}) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 sm:px-10 pt-7 pb-0">
        <img src={`${BASE}logo.svg`} alt="Valgis" className="h-5 opacity-80" />
        <a
          href="https://github.com/thevangelist/valgis"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-xs transition-colors"
        >
          <GithubIcon />
          GitHub
        </a>
      </nav>

      {/* Body */}
      <main className="flex-1 flex flex-col px-6 sm:px-10 pt-20 sm:pt-28 pb-20 max-w-2xl">

        <p className="font-serif italic text-[#D9614A] text-2xl sm:text-3xl mb-7 leading-snug">
          "Do you hear that mountain call?"
        </p>

        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1] mb-8 text-white">
          Spectral enhancement.<br />
          <span className="text-zinc-400">In your browser.</span>
        </h1>

        <p className="text-zinc-400 text-base leading-relaxed mb-3 max-w-md">
          Point your phone at a rock panel. Watch what the camera missed come up in real time.
          Back home, load the DSLR shots and work through the filters.
          The pigment was always there.
        </p>

        <p className="text-zinc-400 text-sm leading-relaxed mb-16 max-w-md">
          PCA-driven. Multispectral-grade. Runs in the browser. Nothing leaves your device.
          Free for researchers under AGPL-3.0.
        </p>

        {/* Modes */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="primary" size="lg" className="justify-start rounded-xl px-5 gap-3" onClick={onDesktop}>
            <Monitor className="w-4 h-4" />
            Open Studio
            <span className="text-black/50 font-normal ml-auto pl-4 hidden sm:block">Desktop</span>
          </Button>
          <Button variant="outline" size="lg" className="justify-start rounded-xl px-5 gap-3 border-zinc-800 bg-zinc-900 hover:bg-zinc-800" onClick={onCamera}>
            <Camera className="w-4 h-4" />
            Open Camera
            <span className="text-zinc-400 font-normal ml-auto pl-4 hidden sm:block">Fieldwork</span>
          </Button>
          <Button variant="outline" size="lg" className="justify-start rounded-xl px-5 gap-3 border-zinc-800 bg-zinc-900 hover:bg-zinc-800" onClick={onAstro}>
            <Star className="w-4 h-4" />
            Open Astro
            <span className="text-zinc-400 font-normal ml-auto pl-4 hidden sm:block">Telescope</span>
          </Button>
        </div>

      </main>

      {/* Footer */}
      <footer className="px-6 sm:px-10 py-5 border-t border-zinc-900 flex items-center justify-between">
        <span className="text-zinc-500 text-xs">AGPL-3.0 license</span>
      </footer>

    </div>
  );
}
