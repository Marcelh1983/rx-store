import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import typescript from "rollup-plugin-typescript2";
import copy from "rollup-plugin-copy";
import packageJson from "./package.json";

export default {
  input: "./libs/rx-basic-store/src/index.ts",
  output: [
    {
      file: packageJson.main,
      format: "cjs",
      sourcemap: true
    },
    {
      file: packageJson.module,
      format: "esm",
      sourcemap: true
    }
  ],
  plugins: [peerDepsExternal(), resolve(), commonjs(), typescript(),
    copy({
      targets: [{ src: ['./package.json', './README.md'], dest: 'dist/lib' }]
    })]
};