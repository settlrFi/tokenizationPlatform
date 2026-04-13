const {formatEther, parseEther, getSigners, keccak256, toUtf8Bytes, parseUnits} = require("ethers");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)"
];


const {MARKET_ADDRESS, STABLE_ADDRESS, ORACLE_ADDRESS, AAPL_ADDRESS, COMPLIANCE_REGISTRY} = process.env;

function idOf(sym) { return keccak256(toUtf8Bytes(sym.toUpperCase())); }

function toOrderId(order) {
  // Se già 0x...32 byte, lo accetto. Altrimenti hash della stringa.
  if (/^0x[0-9a-fA-F]{64}$/.test(order)) return order;
  return ethers.id(order);
}

async function main() {

    const [owner, compliance, depositary, platform, maker, signer] = await ethers.getSigners();

    //const STABLE = await ethers.getContractFactory("UsdCoin");
    const STABLE = await ethers.getContractFactory("SecurityToken");
    const stable = STABLE.attach(STABLE_ADDRESS);

    const Market = await ethers.getContractFactory("Market");
    const market = Market.attach(MARKET_ADDRESS);

    const Oracle = await ethers.getContractFactory("SimpleOracle");
    const oracle = Oracle.attach(ORACLE_ADDRESS);

    const ComplianceRegistry = await ethers.getContractFactory("ComplianceRegistry");
    const complianceRegistry = ComplianceRegistry.attach(COMPLIANCE_REGISTRY);

    console.log('Compliance:', await compliance.getAddress());

    await (await complianceRegistry.connect(compliance).setWhitelist(await signer.getAddress(), true)).wait();
    const now0 = Math.floor(Date.now() / 1000);
    const expiry = now0 + parseInt(1, 10) * 24 * 60 * 60;

    await (await complianceRegistry.connect(compliance).setKycExpiry(await signer.getAddress(), expiry)).wait();

    await complianceRegistry.connect(compliance).setWhitelist(await platform.getAddress(), true);
    await (await complianceRegistry.connect(compliance).setKycExpiry(await platform.getAddress(), expiry)).wait();

    await complianceRegistry.connect(compliance).setWhitelist(await owner.getAddress(), true);
    await (await complianceRegistry.connect(compliance).setKycExpiry(await owner.getAddress(), expiry)).wait();

    await complianceRegistry.connect(compliance).setWhitelist(await market.getAddress(), true);
    await (await complianceRegistry.connect(compliance).setKycExpiry(await market.getAddress(), expiry)).wait();

    await complianceRegistry.connect(compliance).setWhitelist(await maker.getAddress(), true);
    await (await complianceRegistry.connect(compliance).setKycExpiry(await maker.getAddress(), expiry)).wait();

    console.log(await complianceRegistry.connect(compliance).isWhitelisted(await signer.getAddress()));

    //await market.connect(owner).setplatform(platform);
    const PLATFORM_ROLE = await stable.PLATFORM_ROLE();
    await (await stable.connect(owner).grantRole(PLATFORM_ROLE, platform)).wait();

    await (await stable.connect(owner).grantRole(PLATFORM_ROLE, maker)).wait();

    await market.connect(owner).setMaker(platform);
    await market.connect(owner).setMaker(maker);

    const aapl = new ethers.Contract(AAPL_ADDRESS, ERC20_ABI, ethers.provider);

    console.log(formatEther(await ethers.provider.getBalance(await owner.getAddress())));

    console.log(await stable.balanceOf(await owner.getAddress()), parseEther('0.00000001'));

    console.log('Signer Balance:', await stable.balanceOf(await signer.getAddress()), await signer.getAddress() );

    const stableDecimals = Number(await stable.decimals());

    const st_qty = parseUnits("100000", stableDecimals);
    const orderId = toOrderId("0x0000000");


    //await (await stable.connect(depositary).authorizeMint(await signer.getAddress(), st_qty, orderId)).wait();
    //await (await stable.connect(depositary).authorizeMint(await platform.getAddress(), st_qty, orderId)).wait();

    //await stable.connect(owner).transfer( await signer.getAddress(), st_qty);
    //await stable.connect(owner).transfer( await platform.getAddress(), st_qty);

    console.log(await stable.balanceOf(await platform.getAddress()), await platform.getAddress());

    //await stable.connect(platform).approve(market, st_qty);
    //await market.connect(platform).depositStable(st_qty);

    

    console.log(await stable.balanceOf(await platform.getAddress()), await platform.getAddress());

    const id = idOf("AAPL");
    const info = await market.assets(id);
    const tokenDecimals = Number(info.tokenDecimals);

    // Compra 1.0 token
    const qty = parseUnits("1", tokenDecimals);

    //console.log(await market.connect(platform).proposeMint(id,platform,qty,keccak256(toUtf8Bytes("Id"))));

    //await market.connect(depositary).inventoryMint(id, qty, await platform.getAddress());

    console.log(info, qty, stableDecimals, await oracle.decimals());

    console.log(await market.connect(owner).fullInventory());

    const [price, ts] = await oracle.getPrice(id);
    console.log("price=", price.toString(), "ts=", Number(ts));

    // Imposta un tetto di spesa ragionevole (es. $1000)
    const maxCostStable = await stable.balanceOf(await signer.getAddress());

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    console.log({ ts: Number(ts), now });   
    console.log(tokenDecimals);


    console.log('Signer Balance:', await stable.balanceOf(await signer.getAddress()), await signer.getAddress() );
    console.log(await aapl.balanceOf(await signer.getAddress()), await market.connect(owner).fullInventory());
    

    await stable.connect(signer).approve(market, maxCostStable);
    //await market.connect(signer).buyFrom(platform, id, qty, maxCostStable);

    //await aapl.connect(signer).transfer(await platform.getAddress(), parseUnits("0.1", tokenDecimals));

    console.log('Signer Balance:', await stable.balanceOf(await signer.getAddress()), await signer.getAddress() );
    console.log(await aapl.balanceOf(await signer.getAddress()), await market.connect(owner).fullInventory());

    //await aapl.connect(signer).approve(market, qty);
    //await market.connect(signer).sellTo(platform, id, qty, 0);


    console.log('Signer Balance:', await stable.balanceOf(await signer.getAddress()), await signer.getAddress() );
    console.log(await aapl.balanceOf(await signer.getAddress()), await market.connect(owner).fullInventory());

}


main().catch((e) => { console.error(e); process.exit(1); });