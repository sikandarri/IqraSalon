import React from 'react';import {createRoot} from 'react-dom/client';import SalonSite from '../components/salon/SalonSite';import Admin from '../components/salon/Admin';import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname.startsWith('/admin')?<Admin/>:<SalonSite/>}</React.StrictMode>);
