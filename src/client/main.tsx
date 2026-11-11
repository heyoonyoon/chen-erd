import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { App } from './App';
import { startAnalytics } from './analytics';
import { initLocale } from './i18n';

startAnalytics();

// 시작 언어의 사전을 먼저 받아 두고 그린다(영어 화면이 잠깐 보였다가 바뀌지 않게)
void initLocale().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
