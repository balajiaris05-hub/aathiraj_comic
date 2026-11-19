import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
(window as any).__AATHIRAI_MARK_MOUNTED__?.();
(window as any).__AATHIRAI_MOUNTED__ = true;
