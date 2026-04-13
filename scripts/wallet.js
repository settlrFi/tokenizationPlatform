const {formatEther, parseEther, getSigners, keccak256, toUtf8Bytes, parseUnits} = require("ethers");


async function main() {
    const [owner, signer] = await ethers.getSigners();


    console.log(formatEther(await ethers.provider.getBalance(await owner.getAddress())));

    
    
}


main().catch((e) => { console.error(e); process.exit(1); });