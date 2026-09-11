import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, BigNumberish, AddressLike, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../common";
import type { BelrosePaymaster, BelrosePaymasterInterface } from "../../smartContracts/BelrosePaymaster";
type BelrosePaymasterConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class BelrosePaymaster__factory extends ContractFactory {
    constructor(...args: BelrosePaymasterConstructorParams);
    getDeployTransaction(_entryPoint: AddressLike, _verifyingSigner: AddressLike, _maxCostPerUserOp: BigNumberish, overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(_entryPoint: AddressLike, _verifyingSigner: AddressLike, _maxCostPerUserOp: BigNumberish, overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<BelrosePaymaster & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): BelrosePaymaster__factory;
    static readonly bytecode = "0x60a060409080825234620001c557606081620010da8038038091620000258285620001f2565b833981010312620001c55780516001600160a01b038082169291838103620001c55760208084015193838516809503620001c557860151943315620001db57815f54602460018060a01b03199633888416175f558a5194859384923391167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e05f80a36301ffc9a760e01b825263122a0e9b60e31b60048301525afa908115620001d1575f9162000190575b50156200014d575060805281156200013c57600154161760015560025551610eaf90816200022b823960805181818161018501528181610233015281816102e50152818161035b015281816103c60152818161065b0152818161079c01528181610a7d0152610b990152f35b8351634501a91960e01b8152600490fd5b60649086519062461bcd60e51b82526004820152601e60248201527f49456e747279506f696e7420696e74657266616365206d69736d6174636800006044820152fd5b90508181813d8311620001c9575b620001aa8183620001f2565b81010312620001c557518015158103620001c5575f620000d0565b5f80fd5b503d6200019e565b87513d5f823e3d90fd5b8651631e4fbdf760e01b81525f6004820152602490fd5b601f909101601f19168101906001600160401b038211908210176200021657604052565b634e487b7160e01b5f52604160045260245ffdfe604060808152600480361015610013575f80fd5b5f915f3560e01c80630396cb6014610774578063146120531461072457806318120155146106b857838163205c28781461062e5750806323d9ac9b1461060557806352b7512c1461058457806352dd9e1e14610565578063715018a61461050c5780637c627b21146104af5780638da5cb5b14610487578063a7ecd37e146103f9578063b0d691fe146103b157838163bb9fe6bf1461033e578163c23a5cea146102b757508063c399ec881461020657838163d0e30db014610175575063f2fde38b146100de575f80fd5b34610171576020366003190112610171576001600160a01b0382358181169391929084900361016d5761010f610af3565b83156101575750505f54826bffffffffffffffffffffffff60a01b8216175f55167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e05f80a380f35b51631e4fbdf760e01b8152908101849052602490fd5b8480fd5b8280fd5b80848482600319360112610202577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b156101fd578390602483518095819363b760faf960e01b8352309083015234905af19081156101f457506101e15750f35b6101ea90610843565b6101f15780f35b80fd5b513d84823e3d90fd5b505050fd5b5050fd5b503461017157826003193601126101715780516370a0823160e01b815230928101929092526020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9182156102ad578392610275575b6020838351908152f35b9091506020813d6020116102a5575b81610291602093836108a3565b81010312610171576020925051905f61026b565b3d9150610284565b81513d85823e3d90fd5b80848434610202576020366003190112610202576102d361080c565b6102db610af3565b6001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116803b1561033a578592836024928651978895869463611d2e7560e11b865216908401525af19081156101f457506101e15750f35b8580fd5b80848434610202578260031936011261020257610359610af3565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b156101fd57815163bb9fe6bf60e01b81529284918491829084905af19081156101f457506101e15750f35b8382346103f557816003193601126103f557517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5080fd5b5090346101715760203660031901126101715780356001600160a01b038116929083900361048357610429610af3565b82156104765750508082600154826bffffffffffffffffffffffff60a01b82161760015516177f2d025324f0a785e8c12d0a0d91a9caa49df4ef20ff87e0df7213a1d4f3157beb8380a380f35b51634501a91960e01b8152fd5b8380fd5b8382346103f557816003193601126103f557905490516001600160a01b039091168152602090f35b5050346103f55760803660031901126103f5576003813510156103f5576024359067ffffffffffffffff9081831161048357366023840112156104835782013590811161017157369101602401116101f157610509610b97565b80f35b83346101f157806003193601126101f157610525610af3565b5f80546001600160a01b0319811682556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08280a380f35b8382346103f557816003193601126103f5576020906002549051908152f35b5091346101f157600319906060368301126101f15782359167ffffffffffffffff83116103f5576101209083360301126101f1576105f26060856105d586866105cb610b97565b6044359101610c06565b825194838694855283519384809287015260208787019101610822565b6020830152601f01601f19168101030190f35b8382346103f557816003193601126103f55760015490516001600160a01b039091168152602090f35b8084843461020257806003193601126102025761064961080c565b610651610af3565b6001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116803b1561033a578592836044928651978895869463040b850f60e31b8652169084015260243560248401525af19081156101f457506101e15750f35b50903461017157600319926060368501126101f15781359367ffffffffffffffff85116103f5576101209085360301126101f1575065ffffffffffff60243581811681036107205760443591821682036107205760209461071993016108c5565b9051908152f35b5f80fd5b5034610171576020366003190112610171577f598df8bc4d7c3a9a23abde0a78576ee20e96f207ea058d57f5301f5f05fdbcb29135610761610af3565b806002558151908082526020820152a180f35b5060203660031901126107205781359163ffffffff83168093036107205761079a610af3565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031692833b156107205760245f9284519586938492621cb65b60e51b845283015234905af190811561080357506107f7575080f35b6108019150610843565b005b513d5f823e3d90fd5b600435906001600160a01b038216820361072057565b5f5b8381106108335750505f910152565b8181015183820152602001610824565b67ffffffffffffffff811161085757604052565b634e487b7160e01b5f52604160045260245ffd5b6080810190811067ffffffffffffffff82111761085757604052565b6020810190811067ffffffffffffffff82111761085757604052565b90601f8019910116810190811067ffffffffffffffff82111761085757604052565b919091604080516108d58161086b565b6041815260209384820195606096873682378451610936602c828a81019461092665ffffffffffff9965ffffffffffff60d01b808a60d01b1689528a60d01b16602685015251809285850190610822565b810103600c8101845201826108a3565b60e087016109448189610b1e565b6024939193116107205761096a6fffffffffffffffffffffffffffffffff19928a610b1e565b603493919311610720578b946109b36054938360248f95976109c3988f601490519b8c998a01809e30901b90520135166034880152013516604485015251809285850190610822565b81010360348101845201826108a3565b5190206001600160a01b0386358181169392908490036107205760c06109f56109ee898b018b610b1e565b3691610b51565b8a815191012098610a0b6109ee8d830183610b1e565b8b815191012089519a8c8c019788528c8301358b8d01528d8c015260808b0152608081013560a08b015260a0810135828b0152013560e089015261010090818901528752610120870167ffffffffffffffff9780821089831117610857578694828952815190209261014082019384527f00000000000000000000000000000000000000000000000000000000000000001661016082015261018046910152898152610ab68161086b565b519020978551978801988952468689015230908801521660808601521660a084015260a0835260c083019183831090831117610857575251902090565b5f546001600160a01b03163303610b0657565b60405163118cdaa760e01b8152336004820152602490fd5b903590601e1981360301821215610720570180359067ffffffffffffffff82116107205760200191813603831361072057565b92919267ffffffffffffffff82116108575760405191610b7b601f8201601f1916602001846108a3565b829481845281830111610720578281602093845f960137010152565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610bc957565b60405162461bcd60e51b815260206004820152601560248201527414d95b99195c881b9bdd08115b9d1c9e541bda5b9d605a1b6044820152606490fd5b919060025410610d2157610c1d60e0830183610b1e565b908160341161072057603319820191604d8310610d07578260061161072057603482013592600c116107205781610ca6610cac92610c6c603a610cb5960135988960d01c908860d01c906108c5565b7f19457468657265756d205369676e6564204d6573736167653a0a3332000000005f52601c52603c5f209260403692603f19019101610b51565b90610d2f565b90929192610d69565b6001546001600160a01b03918216911614610d015760015b60ff604051610cdb81610887565b5f81529465ffffffffffff60d01b169265ffffffffffff60a01b9060301c169116171790565b5f610ccd565b5050509050604051610d1881610887565b5f815290600190565b9050604051610d1881610887565b8151919060418303610d5f57610d589250602082015190606060408401519301515f1a90610dec565b9192909190565b50505f9160029190565b6004811015610dd85780610d7b575050565b60018103610d955760405163f645eedf60e01b8152600490fd5b60028103610db65760405163fce698f760e01b815260048101839052602490fd5b600314610dc05750565b602490604051906335e2f38360e21b82526004820152fd5b634e487b7160e01b5f52602160045260245ffd5b91907f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a08411610e6e579160209360809260ff5f9560405194855216868401526040830152606082015282805260015afa15610e63575f516001600160a01b03811615610e5957905f905f90565b505f906001905f90565b6040513d5f823e3d90fd5b5050505f916003919056fea26469706673582212208bbf8ee32543f88b8573886019c0dbdb1990a22053880b4e41fb350d0394241664736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "contract IEntryPoint";
            readonly name: "_entryPoint";
            readonly type: "address";
        }, {
            readonly internalType: "address";
            readonly name: "_verifyingSigner";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "_maxCostPerUserOp";
            readonly type: "uint256";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "constructor";
    }, {
        readonly inputs: readonly [];
        readonly name: "ECDSAInvalidSignature";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "length";
            readonly type: "uint256";
        }];
        readonly name: "ECDSAInvalidSignatureLength";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "s";
            readonly type: "bytes32";
        }];
        readonly name: "ECDSAInvalidSignatureS";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "InvalidSignerAddress";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "owner";
            readonly type: "address";
        }];
        readonly name: "OwnableInvalidOwner";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "account";
            readonly type: "address";
        }];
        readonly name: "OwnableUnauthorizedAccount";
        readonly type: "error";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "sender";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "maxCost";
            readonly type: "uint256";
        }];
        readonly name: "GasSponsored";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "oldMaxCost";
            readonly type: "uint256";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "newMaxCost";
            readonly type: "uint256";
        }];
        readonly name: "MaxCostUpdated";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "previousOwner";
            readonly type: "address";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "newOwner";
            readonly type: "address";
        }];
        readonly name: "OwnershipTransferred";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "oldSigner";
            readonly type: "address";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "newSigner";
            readonly type: "address";
        }];
        readonly name: "SignerUpdated";
        readonly type: "event";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint32";
            readonly name: "unstakeDelaySec";
            readonly type: "uint32";
        }];
        readonly name: "addStake";
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "deposit";
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "entryPoint";
        readonly outputs: readonly [{
            readonly internalType: "contract IEntryPoint";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "getDeposit";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly components: readonly [{
                readonly internalType: "address";
                readonly name: "sender";
                readonly type: "address";
            }, {
                readonly internalType: "uint256";
                readonly name: "nonce";
                readonly type: "uint256";
            }, {
                readonly internalType: "bytes";
                readonly name: "initCode";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes";
                readonly name: "callData";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes32";
                readonly name: "accountGasLimits";
                readonly type: "bytes32";
            }, {
                readonly internalType: "uint256";
                readonly name: "preVerificationGas";
                readonly type: "uint256";
            }, {
                readonly internalType: "bytes32";
                readonly name: "gasFees";
                readonly type: "bytes32";
            }, {
                readonly internalType: "bytes";
                readonly name: "paymasterAndData";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes";
                readonly name: "signature";
                readonly type: "bytes";
            }];
            readonly internalType: "struct PackedUserOperation";
            readonly name: "userOp";
            readonly type: "tuple";
        }, {
            readonly internalType: "uint48";
            readonly name: "validUntil";
            readonly type: "uint48";
        }, {
            readonly internalType: "uint48";
            readonly name: "validAfter";
            readonly type: "uint48";
        }];
        readonly name: "getHashWithZeroSignature";
        readonly outputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "";
            readonly type: "bytes32";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "maxCostPerUserOp";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "owner";
        readonly outputs: readonly [{
            readonly internalType: "address";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "enum IPaymaster.PostOpMode";
            readonly name: "mode";
            readonly type: "uint8";
        }, {
            readonly internalType: "bytes";
            readonly name: "context";
            readonly type: "bytes";
        }, {
            readonly internalType: "uint256";
            readonly name: "actualGasCost";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "actualUserOpFeePerGas";
            readonly type: "uint256";
        }];
        readonly name: "postOp";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "renounceOwnership";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "_newMaxCost";
            readonly type: "uint256";
        }];
        readonly name: "setMaxCostPerUserOp";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "newOwner";
            readonly type: "address";
        }];
        readonly name: "transferOwnership";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "unlockStake";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "_newSigner";
            readonly type: "address";
        }];
        readonly name: "updateSigner";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly components: readonly [{
                readonly internalType: "address";
                readonly name: "sender";
                readonly type: "address";
            }, {
                readonly internalType: "uint256";
                readonly name: "nonce";
                readonly type: "uint256";
            }, {
                readonly internalType: "bytes";
                readonly name: "initCode";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes";
                readonly name: "callData";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes32";
                readonly name: "accountGasLimits";
                readonly type: "bytes32";
            }, {
                readonly internalType: "uint256";
                readonly name: "preVerificationGas";
                readonly type: "uint256";
            }, {
                readonly internalType: "bytes32";
                readonly name: "gasFees";
                readonly type: "bytes32";
            }, {
                readonly internalType: "bytes";
                readonly name: "paymasterAndData";
                readonly type: "bytes";
            }, {
                readonly internalType: "bytes";
                readonly name: "signature";
                readonly type: "bytes";
            }];
            readonly internalType: "struct PackedUserOperation";
            readonly name: "userOp";
            readonly type: "tuple";
        }, {
            readonly internalType: "bytes32";
            readonly name: "userOpHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "uint256";
            readonly name: "maxCost";
            readonly type: "uint256";
        }];
        readonly name: "validatePaymasterUserOp";
        readonly outputs: readonly [{
            readonly internalType: "bytes";
            readonly name: "context";
            readonly type: "bytes";
        }, {
            readonly internalType: "uint256";
            readonly name: "validationData";
            readonly type: "uint256";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "verifyingSigner";
        readonly outputs: readonly [{
            readonly internalType: "address";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address payable";
            readonly name: "withdrawAddress";
            readonly type: "address";
        }];
        readonly name: "withdrawStake";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address payable";
            readonly name: "withdrawAddress";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly name: "withdrawTo";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }];
    static createInterface(): BelrosePaymasterInterface;
    static connect(address: string, runner?: ContractRunner | null): BelrosePaymaster;
}
export {};
//# sourceMappingURL=BelrosePaymaster__factory.d.ts.map