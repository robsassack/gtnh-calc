import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";

const requiredFiles = ["data/data.bin", "data/atlas.webp"];
const missingFiles = [];

for (const file of requiredFiles) {
    try {
        const fileStat = await stat(file);
        await access(file, constants.R_OK);
        if (!fileStat.isFile() || fileStat.size === 0) {
            missingFiles.push(file);
        }
    } catch {
        missingFiles.push(file);
    }
}

if (missingFiles.length > 0) {
    console.error(`Missing generated data files: ${missingFiles.join(", ")}`);
    console.error("");
    console.error("The calculator data lives in the data git submodule.");
    console.error("Run this once before building:");
    console.error("");
    console.error("  git submodule update --init --recursive");
    console.error("");
    console.error("Then run npm run build again.");
    process.exit(1);
}
