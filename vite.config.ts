import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { ogDevPlugin } from './server/dev/og-vite-plugin';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), ogDevPlugin()],
	// Nitro serves this directory as-is; `index.html` is moved out of it after the build so the
	// server can inject per-link OpenGraph tags into it (see scripts/split-build.ts)
	build: { outDir: 'dist/public', emptyOutDir: true },
	// Saved settings and custom steppers live in localStorage, which is per origin. A fixed port keeps
	// the origin stable between dev sessions instead of silently moving to 5174 when 5173 is busy
	server: { port: 5173, strictPort: true },
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src')
		}
	}
});
