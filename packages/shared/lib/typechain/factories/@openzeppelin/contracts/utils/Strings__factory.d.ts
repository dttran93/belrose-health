import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../../common";
import type { Strings, StringsInterface } from "../../../../@openzeppelin/contracts/utils/Strings";
type StringsConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class Strings__factory extends ContractFactory {
    constructor(...args: StringsConstructorParams);
    getDeployTransaction(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<Strings & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): Strings__factory;
    static readonly bytecode = "0x6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea26469706673582212209377b8fcead78acbdd6cff63d102225cd26aeb6a7d1984a58eddd32c9c2e8c2f64736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "length";
            readonly type: "uint256";
        }];
        readonly name: "StringsInsufficientHexLength";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "StringsInvalidAddressFormat";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "StringsInvalidChar";
        readonly type: "error";
    }];
    static createInterface(): StringsInterface;
    static connect(address: string, runner?: ContractRunner | null): Strings;
}
export {};
//# sourceMappingURL=Strings__factory.d.ts.map