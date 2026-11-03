import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // На GitHub Pages сайт жил бы по адресу /<репозиторий>/; локально и на Cloudflare Pages — в корне
  base: process.env.GITHUB_PAGES ? '/blueprint-lab/' : '/',
})
