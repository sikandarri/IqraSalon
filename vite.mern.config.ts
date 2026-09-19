import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import {resolve} from 'node:path';
export default defineConfig({root:'client',publicDir:resolve('public'),plugins:[react()],resolve:{alias:{'@':resolve('.')}},build:{outDir:resolve('dist-mern'),emptyOutDir:true},server:{proxy:{'/api':'http://localhost:3000'}}});
