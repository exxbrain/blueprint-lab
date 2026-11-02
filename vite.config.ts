import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // На GitHub Pages сайт живёт по адресу /<репозиторий>/; локально — в корне
  base: process.env.GITHUB_PAGES ? '/blueprint-lab/' : '/',
})
