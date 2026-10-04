import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CANVAS_WIDTH } from '@shared/constants';

// Placeholder entry — replaced by the real app in client/src/App.tsx.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div>Skribble client scaffold ({CANVAS_WIDTH})</div>
  </StrictMode>,
);
