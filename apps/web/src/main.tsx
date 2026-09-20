import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root 를 찾을 수 없습니다.');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
