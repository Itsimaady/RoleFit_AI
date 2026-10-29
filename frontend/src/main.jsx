import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/resume.css';
import './styles/features.css';

// Apply the saved theme before first paint to avoid a flash.
try {
  const saved = localStorage.getItem('rolefit-theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
