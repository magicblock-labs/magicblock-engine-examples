import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import {Wallet} from "./components/Wallet";

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <Wallet app={<App />} />
    </React.StrictMode>
);
