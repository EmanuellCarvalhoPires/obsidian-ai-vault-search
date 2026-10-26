import fs from "fs";
import path from "path";

const pluginId = "ai-vault-search";
const targetVaults = [
  path.join(process.env.USERPROFILE || "", "Documents", "Cofre"),
  path.join(process.env.USERPROFILE || "", "Documents", "AI Vault"),
];

const filesToCopy = ["main.js", "manifest.json"];

for (const vault of targetVaults) {
  if (!fs.existsSync(vault)) continue;
  const vaultPluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
  fs.mkdirSync(vaultPluginDir, { recursive: true });

  for (const file of filesToCopy) {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(vaultPluginDir, file));
      console.log(`Copied ${file} -> ${vaultPluginDir}`);
    }
  }
  console.log(`Deploy concluído em ${vaultPluginDir}`);
}
