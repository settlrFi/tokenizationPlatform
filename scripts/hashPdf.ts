import fs from "fs";
import { ethers } from "ethers";  // oppure "hardhat"

const filePath = "nav_report_2025_10_30.pdf";
const pdfBytes = fs.readFileSync(filePath);
const fileHash = ethers.keccak256(pdfBytes);
console.log("Hash del file:", fileHash);
