import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../../common";
import type { UserOperationLib, UserOperationLibInterface } from "../../../../@account-abstraction/contracts/core/UserOperationLib";
type UserOperationLibConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class UserOperationLib__factory extends ContractFactory {
    constructor(...args: UserOperationLibConstructorParams);
    getDeployTransaction(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<UserOperationLib & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): UserOperationLib__factory;
    static readonly bytecode = "0x608080604052346100195760b0908161001e823930815050f35b5f80fdfe60808060405260043610156011575f80fd5b5f3560e01c90816325093e1b14606757508063b29a8ff41460525763ede31502146039575f80fd5b5f366003190112604e57602060405160348152f35b5f80fd5b5f366003190112604e57602060405160148152f35b5f366003190112604e5780602460209252f3fea26469706673582212203f65a60b09b2f86317639fbf7d780ac8609954c9e2908b27e186e0625ac1f19664736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [];
        readonly name: "PAYMASTER_DATA_OFFSET";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "PAYMASTER_POSTOP_GAS_OFFSET";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "PAYMASTER_VALIDATION_GAS_OFFSET";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }];
    static createInterface(): UserOperationLibInterface;
    static connect(address: string, runner?: ContractRunner | null): UserOperationLib;
}
export {};
//# sourceMappingURL=UserOperationLib__factory.d.ts.map