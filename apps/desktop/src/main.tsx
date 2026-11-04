import React from 'react';import {createRoot} from 'react-dom/client';import '@fontsource-variable/noto-sans-sc';import './styles.css';import './motion.css';import {installMotionInput} from './motion';import App from './App';
installMotionInput();
createRoot(document.getElementById('root')!).render(<App/>);

