import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,

  /**
   * Bundle @dp/shared instead of leaving it as an import.
   *
   * The package ships raw TypeScript on purpose — `main` points at
   * ./src/index.ts, which is why apps/web carries `transpilePackages`. tsup
   * keeps every package.json dependency external, so the built bundle imported
   * '@dp/shared' verbatim and `node dist/server.js` died at boot with
   * ERR_MODULE_NOT_FOUND on packages/shared/src/money: a .ts file with
   * extensionless imports is not something Node can load, and Node refuses to
   * strip types inside node_modules at all.
   *
   * Nothing caught it because dev runs under tsx, which compiles the workspace
   * on the fly — `start` is only ever used by Railway.
   */
  noExternal: ['@dp/shared'],
})
