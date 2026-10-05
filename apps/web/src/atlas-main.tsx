/**
 * Standalone entry point for the anatomy atlas viewer spike.
 *
 * A separate HTML entry rather than a route inside the product, so the spike
 * cannot affect the existing interview flow. The domain, the store, the API and
 * every clinical surface are untouched by this file.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AtlasViewer } from './atlas/AtlasViewer.tsx';
import './tokens.css';
import './atlas/atlas.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <AtlasViewer />
  </StrictMode>,
);
