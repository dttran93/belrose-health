import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../../../common";
import type { MessageHashUtils, MessageHashUtilsInterface } from "../../../../../@openzeppelin/contracts/utils/cryptography/MessageHashUtils";
type MessageHashUtilsConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class MessageHashUtils__factory extends ContractFactory {
    constructor(...args: MessageHashUtilsConstructorParams);
    getDeployTransaction(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<MessageHashUtils & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): MessageHashUtils__factory;
    static readonly bytecode = "0x6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea26469706673582212203f7e025c34e9de8a4c2a7d891c33911b00a3f3ddf5d2d910837b82ffe1e3b75c64736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [];
        readonly name: "ERC5267ExtensionsNotSupported";
        readonly type: "error";
    }];
    static createInterface(): MessageHashUtilsInterface;
    static connect(address: string, runner?: ContractRunner | null): MessageHashUtils;
}
export {};
//# sourceMappingURL=MessageHashUtils__factory.d.ts.map