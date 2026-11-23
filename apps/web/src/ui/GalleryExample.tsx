import type { ReactNode } from 'react';

type ExampleProps = { id: string; children: ReactNode; canvas?: boolean };

export function GalleryExample({ id, children, canvas }: ExampleProps) {
  return (
    <div>
      <div className="text-12 text-muted">{id}</div>
      <div data-gallery={id} className={canvas ? 'bg-canvas' : 'bg-surface'}>
        {children}
      </div>
    </div>
  );
}
