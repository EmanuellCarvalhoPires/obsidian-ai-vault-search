import fs from "fs";
import path from "path";

const pluginId = "ai-vault-search";
const vaultPluginDir = path.join(
  process.env.USERPROFILE || "",
  "Documents",
  "Cofre",
  ".obsidian",
  "plugins",
  pluginId
);

fs.mkdirSync(vaultPluginDir, { recursive: true });

const filesToCopy = ["main.js", "manifest.json"];
for (const file of filesToCopy) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(vaultPluginDir, file));
    console.log(`Copied ${file} -> ${vaultPluginDir}`);
  }
}
console.log(`Deploy concluído em ${vaultPluginDir}`);
