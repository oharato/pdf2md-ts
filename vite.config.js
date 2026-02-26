import { defineConfig } from "vite";
export default defineConfig({
    test: {
        include: ["tests/**/*.spec.ts"],
        environment: "node"
    }
});
