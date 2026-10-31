import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	// Server code reads process.env; `vite dev` would otherwise not see .env.
	if (mode === 'development') Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
	return {
		plugins: [sveltekit()],
		test: {
			include: ['tests/**/*.test.ts'],
			globalSetup: 'tests/global-setup.ts',
			fileParallelism: false,
			testTimeout: 60_000,
			hookTimeout: 120_000
		}
	};
});
