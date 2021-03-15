// rollup.config.js
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';
import packageJson from './package.json';

export default {
  input: './libs/rx-basic-store/src/index.ts',
  output: [
    {
      file: packageJson.main,
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: packageJson.module,
      format: 'esm',
      sourcemap: true,
    },
  ],
  output: {
    file: './dist/lib/index.js',
},
  plugins: [
    peerDepsExternal(),
    resolve(),
    commonjs(),
    typescript({
      tsconfig: './libs/rx-basic-store/tsconfig.lib.json'
    }),
    copy({
      targets: [{ src: ['./package.json', './README.md'], dest: 'dist/lib' }],
    }),
  ],
};
