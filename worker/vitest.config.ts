import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests del worker importan código de la app web
    // (../src/repositories/drive-sheets-create.js) — se permite el acceso al
    // repo raíz para no tener que duplicar el módulo en worker/.
    server: {
      fs: { allow: ['..'] },
    },
  },
});
