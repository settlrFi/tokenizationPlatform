// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./tokens/interfaces/IReferenceOracle.sol";

contract Market is
    Initializable,
    UUPSUpgradeable,
    AccessControlEnumerableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");
    bytes32 public constant ORACLE_ROLE    = keccak256("ORACLE_ROLE");      // bot che registra costi oracolo
    bytes32 public constant INVENTORY_ROLE = keccak256("INVENTORY_ROLE");   // maker/fornitori di inventario

    struct AssetInfo {
        IERC20  token;         // ERC20 qualsiasi (EquityToken proxy)
        string  symbolText;     // per UI
        uint8   tokenDecimals;
        bool    listed;
        uint256 minBuyAmount;
    }

    mapping(bytes32 => AssetInfo) public assets;

    // ======= (prima erano immutable) =======
    IERC20 public stable;
    uint8  public stableDecimals;

    bytes32[] private _assetIds;

    IReferenceOracle public oracle;
    uint256 public feeBps;          // es. 30 = 0.30% (va al maker)
    uint256 public maxStaleness;    // in secondi

    // ---- Oracle debt / surcharge
    uint256 public oracleDebtStable;          // debito oracolo in "stable decimals"
    uint256 public oracleSurchargePerTrade;   // quanto recuperare max per trade (in stable)

    // ---- Inventari (escrow interno al Market)
    mapping(address => uint256) public invStable;
    mapping(address => mapping(bytes32 => uint256)) public invAsset;

    // ---- Eventi
    event AssetListed(bytes32 indexed id, address token, string symbol);

    event InventoryStableDeposited(address indexed maker, uint256 amount);
    event InventoryStableWithdrawn(address indexed maker, uint256 amount);
    event InventoryAssetDeposited(address indexed maker, bytes32 indexed id, uint256 qty);
    event InventoryAssetWithdrawn(address indexed maker, bytes32 indexed id, uint256 qty);

    event BoughtFrom(
        address indexed user,
        address indexed maker,
        bytes32 indexed id,
        uint256 qty,
        uint256 price,
        uint256 costStable,
        uint256 feeToMaker,
        uint256 extra
    );

    event SoldTo(
        address indexed user,
        address indexed maker,
        bytes32 indexed id,
        uint256 qty,
        uint256 price,
        uint256 proceedsStable,
        uint256 feeToMaker,
        uint256 extra
    );

    event FeesWithdrawn(address to, uint256 amount);
    event OracleDebtAccrued(uint256 amountStable, uint256 newDebt);
    event OracleDebtSettled(uint256 collectedStable, uint256 newDebt);
    event OracleSurchargePerTradeSet(uint256 amountStable);

    // ---- (opzionale) eventi “proposta” per orchestrare mint/burn OFF-Market
    event MakerMintProposed(bytes32 indexed id, address maker, uint256 netAmount, bytes32 orderId);
    event MakerBurnProposed(bytes32 indexed id, address maker, uint256 netAmount, uint256 fee, bytes32 orderId);

    /// @dev blocca initialize sull'implementation (best practice)
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer (sostituisce il constructor nel pattern proxy)
    /// @param stable_  token stable usato per i regolamenti
    /// @param oracle_  reference oracle per prezzi
    /// @param feeBps_  fee in basis points
    /// @param maxStaleness_ max staleness per prezzo oracle
    /// @param admin governance/admin (multisig/timelock)
    function initialize(
        address stable_,
        address oracle_,
        uint256 feeBps_,
        uint256 maxStaleness_,
        address admin
    ) external initializer {
        require(stable_ != address(0) && oracle_ != address(0), "bad addr");
        require(admin != address(0), "bad admin");

        __AccessControlEnumerable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        stable = IERC20(stable_);
        stableDecimals = IERC20Metadata(stable_).decimals();

        oracle = IReferenceOracle(oracle_);
        feeBps = feeBps_;
        maxStaleness = maxStaleness_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    // ----- Admin -----

    function setMaker(address maker_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(maker_ != address(0), "bad maker");
        _grantRole(INVENTORY_ROLE, maker_);
    }

    function setOracle(address oracle_) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
        require(oracle_ != address(0), "bad oracle");
        oracle = IReferenceOracle(oracle_);
    }

    function setFeeBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
        require(bps <= 1000, "fee too high"); // <= 10%
        feeBps = bps;
    }

    function setMaxStaleness(uint256 s) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
        maxStaleness = s;
    }

    function setOracleSurchargePerTrade(uint256 amountStable) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracleSurchargePerTrade = amountStable;
        emit OracleSurchargePerTradeSet(amountStable);
    }

    function listAsset(
        bytes32 id,
        address token_,
        string memory symbolText,
        uint8 tokenDecimals,
        uint256 minBuyAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
        require(!assets[id].listed, "exists");
        require(token_ != address(0), "bad token address");

        assets[id] = AssetInfo({
            token: IERC20(token_),
            symbolText: symbolText,
            tokenDecimals: tokenDecimals,
            listed: true,
            minBuyAmount: minBuyAmount
        });

        _assetIds.push(id);
        emit AssetListed(id, token_, symbolText);
    }

    function getAllAssetIds() external view onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32[] memory ids) {
        ids = new bytes32[](_assetIds.length);
        for (uint i = 0; i < _assetIds.length; i++) ids[i] = _assetIds[i];
    }

    function withdrawFees(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stable.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // ---- Pause controls
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ---- Oracle cost (registrazione dal bot)

    function accrueOracleCostStable(uint256 amountStable) external onlyRole(ORACLE_ROLE) {
        oracleDebtStable += amountStable;
        emit OracleDebtAccrued(amountStable, oracleDebtStable);
    }

    function setOracleDebtStable(uint256 newDebt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracleDebtStable = newDebt;
        emit OracleDebtAccrued(0, oracleDebtStable);
    }

    // ---- INVENTORY: depositi/prelievi stable

    function depositStable(uint256 amount) external onlyRole(INVENTORY_ROLE) nonReentrant whenNotPaused {
        require(amount > 0, "zero");
        stable.safeTransferFrom(msg.sender, address(this), amount);
        invStable[msg.sender] += amount;
        emit InventoryStableDeposited(msg.sender, amount);
    }

    function withdrawStable(uint256 amount) external onlyRole(INVENTORY_ROLE) nonReentrant whenNotPaused {
        require(invStable[msg.sender] >= amount, "insufficient");
        invStable[msg.sender] -= amount;
        stable.safeTransfer(msg.sender, amount);
        emit InventoryStableWithdrawn(msg.sender, amount);
    }

    // ---- INVENTORY: depositi/prelievi asset (token)

    function depositAsset(bytes32 id, uint256 qty) external onlyRole(INVENTORY_ROLE) nonReentrant whenNotPaused {
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");
        require(qty > 0, "zero");

        A.token.safeTransferFrom(msg.sender, address(this), qty);
        invAsset[msg.sender][id] += qty;

        emit InventoryAssetDeposited(msg.sender, id, qty);
    }

    function withdrawAsset(bytes32 id, uint256 qty) external onlyRole(INVENTORY_ROLE) nonReentrant whenNotPaused {
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");
        require(invAsset[msg.sender][id] >= qty, "insufficient");

        invAsset[msg.sender][id] -= qty;
        A.token.safeTransfer(msg.sender, qty);

        emit InventoryAssetWithdrawn(msg.sender, id, qty);
    }

    // ---- Helpers -----

    function _getFreshPrice(bytes32 id) internal view returns (uint256 price, uint256 oracleDec) {
        (uint256 p, uint256 ts) = oracle.getReference(id);
        require(ts <= block.timestamp, "oracle ts in future");
        //require(block.timestamp - ts <= maxStaleness, "stale price");
        oracleDec = oracle.decimals();
        return (p, oracleDec);
    }

    // (qty / 10^tokenDec) * (price / 10^oracleDec) * 10^stableDec
    function _valueInStable(uint256 qty, uint8 tokenDec, uint256 price, uint256 oracleDec)
        internal
        view
        returns (uint256)
    {
        // qty * price * 10^stableDec / (10^tokenDec * 10^oracleDec)
        uint256 num = qty * price;
        uint256 den = (10 ** uint256(tokenDec)) * (10 ** uint256(oracleDec));
        return Math.mulDiv(num, 10 ** uint256(stableDecimals), den);
    }

    function _oracleSurchargeNow() internal view returns (uint256) {
        if (oracleDebtStable == 0) return 0;
        uint256 cap = oracleSurchargePerTrade;
        if (cap == 0) return 0;
        return oracleDebtStable > cap ? cap : oracleDebtStable;
    }

    // ---- TRADING: comprare da un maker

    function buyFrom(address maker, bytes32 id, uint256 qty, uint256 maxCostStable)
        external
        nonReentrant
        whenNotPaused
    {
        require(hasRole(INVENTORY_ROLE, maker), "not maker");
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");
        require(invAsset[maker][id] >= qty, "maker: insufficient asset");
        require(qty > A.minBuyAmount, "Less than minimum amount");

        (uint256 price, uint256 oracleDec) = _getFreshPrice(id);
        uint256 cost  = _valueInStable(qty, A.tokenDecimals, price, oracleDec);
        uint256 fee   = Math.mulDiv(cost, feeBps, 10_000);
        uint256 extra = _oracleSurchargeNow();
        uint256 total = cost + fee + extra;

        require(total <= maxCostStable, "slippage");

        stable.safeTransferFrom(msg.sender, address(this), total);

        invStable[maker] += (cost + fee);

        if (extra != 0) {
            unchecked { oracleDebtStable -= extra; }
            emit OracleDebtSettled(extra, oracleDebtStable);
        }

        invAsset[maker][id] -= qty;
        A.token.safeTransfer(msg.sender, qty);

        emit BoughtFrom(msg.sender, maker, id, qty, price, cost, fee, extra);
    }

    // ---- TRADING: vendere a un maker

    function sellTo(address maker, bytes32 id, uint256 qty, uint256 minProceedsStable)
        external
        nonReentrant
        whenNotPaused
    {
        require(hasRole(INVENTORY_ROLE, maker), "not maker");
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");

        (uint256 price, uint256 oracleDec) = _getFreshPrice(id);
        uint256 proceeds = _valueInStable(qty, A.tokenDecimals, price, oracleDec);
        uint256 fee      = Math.mulDiv(proceeds, feeBps, 10_000);
        uint256 extra    = _oracleSurchargeNow();
        uint256 payout   = proceeds - fee - extra;

        require(payout >= minProceedsStable, "slippage");
        require(invStable[maker] >= (payout + extra), "maker: insufficient stable");

        A.token.safeTransferFrom(msg.sender, address(this), qty);
        invAsset[maker][id] += qty;

        invStable[maker] -= (payout + extra);
        invStable[maker] += fee;

        stable.safeTransfer(msg.sender, payout);

        if (extra != 0) {
            unchecked { oracleDebtStable -= extra; }
            emit OracleDebtSettled(extra, oracleDebtStable);
        }

        emit SoldTo(msg.sender, maker, id, qty, price, proceeds, fee, extra);
    }

    function tokenAddress(bytes32 id) external view returns (address) {
        return address(assets[id].token);
    }

    function quoteBuyFrom(bytes32 id, uint256 qty)
        external
        view
        returns (uint256 total, uint256 cost, uint256 fee, uint256 extra)
    {
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");
        (uint256 p, uint256 oDec) = _getFreshPrice(id);
        cost  = _valueInStable(qty, A.tokenDecimals, p, oDec);
        fee   = Math.mulDiv(cost, feeBps, 10_000);
        extra = _oracleSurchargeNow();
        total = cost + fee + extra;
    }

    function quoteSellTo(bytes32 id, uint256 qty)
        external
        view
        returns (uint256 payout, uint256 proceeds, uint256 fee, uint256 extra)
    {
        AssetInfo memory A = assets[id];
        require(A.listed, "not listed");
        (uint256 p, uint256 oDec) = _getFreshPrice(id);
        proceeds = _valueInStable(qty, A.tokenDecimals, p, oDec);
        fee   = Math.mulDiv(proceeds, feeBps, 10_000);
        extra = _oracleSurchargeNow();
        payout = proceeds - fee - extra;
    }

    /// @dev UUPS authorization: solo governance/admin può aggiornare l’implementation
    function _authorizeUpgrade(address newImplementation)
        internal
        view
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newImplementation != address(0), "bad impl");
    }

    // storage gap per future versioni
    uint256[50] private __gap;
}
