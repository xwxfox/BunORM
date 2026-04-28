import { defineConfig } from "bunup";

export default defineConfig(
	{
		entry: "src/index.ts",
		format: "esm",
		target: "bun",
		outDir: "dist",
        minify: true,
        dts: true,
        clean: true,
	},
) as ReturnType<typeof defineConfig>;