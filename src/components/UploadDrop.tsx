import { useState } from 'react';
import type { DragEvent } from 'react';
import { Upload } from 'lucide-react';

export function UploadDrop({ accept, isSupported, onFile, label = 'Upload or Drop Image' }: {
  accept: string; isSupported: (f: File) => boolean; onFile: (f: File) => void; label?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const over  = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
  const leave = (e: DragEvent) => { e.preventDefault(); setDragging(false); };
  const drop  = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && isSupported(f)) onFile(f);
  };
  return (
    <div onDragOver={over} onDragLeave={leave} onDrop={drop}
      className={`flex items-center justify-center w-full px-3 py-4 bg-card rounded-lg border-2 border-dashed cursor-pointer transition ${dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'}`}>
      <label className="cursor-pointer text-center w-full">
        <Upload className="mx-auto mb-1.5" size={20}/>
        <span className="text-[11px] block">{dragging ? 'Drop image here' : label}</span>
        <input type="file" accept={accept} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}/>
      </label>
    </div>
  );
}
