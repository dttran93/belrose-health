import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, BytesLike, AddressLike, ContractDeployTransaction, ContractRunner } from "ethers";
import type { PayableOverrides } from "../../../../../common";
import type { ERC1967Proxy, ERC1967ProxyInterface } from "../../../../../@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy";
type ERC1967ProxyConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class ERC1967Proxy__factory extends ContractFactory {
    constructor(...args: ERC1967ProxyConstructorParams);
    getDeployTransaction(implementation: AddressLike, _data: BytesLike, overrides?: PayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(implementation: AddressLike, _data: BytesLike, overrides?: PayableOverrides & {
        from?: string;
    }): Promise<ERC1967Proxy & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): ERC1967Proxy__factory;
    static readonly bytecode = "0x6040608081526102c5803803806100158161018c565b928339810182828203126101745781516001600160a01b038116928382036101745760208181015190916001600160401b039190828211610174570184601f8201121561017457805191821161017857610077601f8301601f1916840161018c565b94828652838383010111610174575f5b828110610161575050905f918401015281511561015057803b15610138577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916841790558351927fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a281511561011c5761010e92506101b1565b505b51608290816102438239f35b5050346101295750610110565b63b398979f60e01b8152600490fd5b8351634c9c8ce360e01b815260048101849052602490fd5b83516330a289cf60e21b8152600490fd5b8181018401518682018501528301610087565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b6040519190601f01601f191682016001600160401b0381118382101761017857604052565b905f8091602081519101845af4808061022f575b156101e55750506040513d81523d5f602083013e60203d82010160405290565b1561020c57604051639996b31560e01b81526001600160a01b039091166004820152602490fd5b3d1561021d576040513d5f823e3d90fd5b60405163d6bda27560e01b8152600490fd5b503d1515806101c55750813b15156101c556fe60806040527f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545f9081906001600160a01b0316368280378136915af43d5f803e156048573d5ff35b3d5ffdfea2646970667358221220488679945504be8ff8f387239f290c969a3241f8b64e4cb13325201f62d8d58b64736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "implementation";
            readonly type: "address";
        }, {
            readonly internalType: "bytes";
            readonly name: "_data";
            readonly type: "bytes";
        }];
        readonly stateMutability: "payable";
        readonly type: "constructor";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "target";
            readonly type: "address";
        }];
        readonly name: "AddressEmptyCode";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "implementation";
            readonly type: "address";
        }];
        readonly name: "ERC1967InvalidImplementation";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "ERC1967NonPayable";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "ERC1967ProxyUninitialized";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "FailedCall";
        readonly type: "error";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "implementation";
            readonly type: "address";
        }];
        readonly name: "Upgraded";
        readonly type: "event";
    }, {
        readonly stateMutability: "payable";
        readonly type: "fallback";
    }];
    static createInterface(): ERC1967ProxyInterface;
    static connect(address: string, runner?: ContractRunner | null): ERC1967Proxy;
}
export {};
//# sourceMappingURL=ERC1967Proxy__factory.d.ts.map