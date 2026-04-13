const { getSigners, getContractFactory } = require("ethers");
const envAddress = require("./utils");

async function main() {
    const [owner, signer] = await ethers.getSigners();


    Stable = await ethers.getContractFactory("UsdCoin")//("UsdCoin", owner);
    stable = await Stable.connect(owner).deploy(owner.address);
    await stable.waitForDeployment();

    const stable_addr = await stable.getAddress();

    envAddress("STABLE_ADDRESS", stable_addr);
    console.log("Stable Address: ", stable_addr);

    Token = await ethers.getContractFactory("DOPE", owner)//("UsdCoin", owner)
    token = await Token.connect(owner).deploy();


    const token_addr = await token.getAddress();
    envAddress("TOKEN_ADDRESS", token_addr);
    console.log("Token Address: ", token_addr);

}


main().catch((e) => { console.error(e); process.exit(1); });