// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LocalPythMock {
    struct Price {
        int64  price;        // es. 26970000000 per 269.700000000 con expo=-8
        uint64 conf;         // confidenza nella stessa scala di 'price'
        int32  expo;         // spesso negativo (es. -8)
        uint   publishTime;  // secondi
    }

    struct PriceUpdate {
        bytes32 id;
        int64  price;
        uint64 conf;
        int32  expo;
        uint   publishTime;
    }

    mapping(bytes32 => Price) public prices;

    function getUpdateFee(bytes[] calldata) external pure returns (uint) {
        return 0; // fee zero in mock
    }

    function updatePriceFeeds(bytes[] calldata updates) external payable {
        for (uint i=0; i<updates.length; i++) {
            PriceUpdate memory u = abi.decode(updates[i], (PriceUpdate));
            prices[u.id] = Price(u.price, u.conf, u.expo, u.publishTime);
        }
    }

    // Lettura con guard su età (revert se troppo vecchio)
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory p) {
        p = prices[id];
        require(p.publishTime != 0, "no price");
        require(block.timestamp - p.publishTime <= age, "stale");
    }
}
