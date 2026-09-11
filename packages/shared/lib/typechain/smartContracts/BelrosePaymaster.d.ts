import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../common";
export type PackedUserOperationStruct = {
    sender: AddressLike;
    nonce: BigNumberish;
    initCode: BytesLike;
    callData: BytesLike;
    accountGasLimits: BytesLike;
    preVerificationGas: BigNumberish;
    gasFees: BytesLike;
    paymasterAndData: BytesLike;
    signature: BytesLike;
};
export type PackedUserOperationStructOutput = [
    sender: string,
    nonce: bigint,
    initCode: string,
    callData: string,
    accountGasLimits: string,
    preVerificationGas: bigint,
    gasFees: string,
    paymasterAndData: string,
    signature: string
] & {
    sender: string;
    nonce: bigint;
    initCode: string;
    callData: string;
    accountGasLimits: string;
    preVerificationGas: bigint;
    gasFees: string;
    paymasterAndData: string;
    signature: string;
};
export interface BelrosePaymasterInterface extends Interface {
    getFunction(nameOrSignature: "addStake" | "deposit" | "entryPoint" | "getDeposit" | "getHashWithZeroSignature" | "maxCostPerUserOp" | "owner" | "postOp" | "renounceOwnership" | "setMaxCostPerUserOp" | "transferOwnership" | "unlockStake" | "updateSigner" | "validatePaymasterUserOp" | "verifyingSigner" | "withdrawStake" | "withdrawTo"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "GasSponsored" | "MaxCostUpdated" | "OwnershipTransferred" | "SignerUpdated"): EventFragment;
    encodeFunctionData(functionFragment: "addStake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "deposit", values?: undefined): string;
    encodeFunctionData(functionFragment: "entryPoint", values?: undefined): string;
    encodeFunctionData(functionFragment: "getDeposit", values?: undefined): string;
    encodeFunctionData(functionFragment: "getHashWithZeroSignature", values: [PackedUserOperationStruct, BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "maxCostPerUserOp", values?: undefined): string;
    encodeFunctionData(functionFragment: "owner", values?: undefined): string;
    encodeFunctionData(functionFragment: "postOp", values: [BigNumberish, BytesLike, BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "renounceOwnership", values?: undefined): string;
    encodeFunctionData(functionFragment: "setMaxCostPerUserOp", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "transferOwnership", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "unlockStake", values?: undefined): string;
    encodeFunctionData(functionFragment: "updateSigner", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "validatePaymasterUserOp", values: [PackedUserOperationStruct, BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "verifyingSigner", values?: undefined): string;
    encodeFunctionData(functionFragment: "withdrawStake", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "withdrawTo", values: [AddressLike, BigNumberish]): string;
    decodeFunctionResult(functionFragment: "addStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "deposit", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "entryPoint", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getDeposit", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getHashWithZeroSignature", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "maxCostPerUserOp", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "postOp", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "renounceOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setMaxCostPerUserOp", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "transferOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "unlockStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "updateSigner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "validatePaymasterUserOp", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "verifyingSigner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawTo", data: BytesLike): Result;
}
export declare namespace GasSponsoredEvent {
    type InputTuple = [sender: AddressLike, maxCost: BigNumberish];
    type OutputTuple = [sender: string, maxCost: bigint];
    interface OutputObject {
        sender: string;
        maxCost: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace MaxCostUpdatedEvent {
    type InputTuple = [oldMaxCost: BigNumberish, newMaxCost: BigNumberish];
    type OutputTuple = [oldMaxCost: bigint, newMaxCost: bigint];
    interface OutputObject {
        oldMaxCost: bigint;
        newMaxCost: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace OwnershipTransferredEvent {
    type InputTuple = [previousOwner: AddressLike, newOwner: AddressLike];
    type OutputTuple = [previousOwner: string, newOwner: string];
    interface OutputObject {
        previousOwner: string;
        newOwner: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace SignerUpdatedEvent {
    type InputTuple = [oldSigner: AddressLike, newSigner: AddressLike];
    type OutputTuple = [oldSigner: string, newSigner: string];
    interface OutputObject {
        oldSigner: string;
        newSigner: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export interface BelrosePaymaster extends BaseContract {
    connect(runner?: ContractRunner | null): BelrosePaymaster;
    waitForDeployment(): Promise<this>;
    interface: BelrosePaymasterInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    addStake: TypedContractMethod<[
        unstakeDelaySec: BigNumberish
    ], [
        void
    ], "payable">;
    deposit: TypedContractMethod<[], [void], "payable">;
    entryPoint: TypedContractMethod<[], [string], "view">;
    getDeposit: TypedContractMethod<[], [bigint], "view">;
    getHashWithZeroSignature: TypedContractMethod<[
        userOp: PackedUserOperationStruct,
        validUntil: BigNumberish,
        validAfter: BigNumberish
    ], [
        string
    ], "view">;
    maxCostPerUserOp: TypedContractMethod<[], [bigint], "view">;
    owner: TypedContractMethod<[], [string], "view">;
    postOp: TypedContractMethod<[
        mode: BigNumberish,
        context: BytesLike,
        actualGasCost: BigNumberish,
        actualUserOpFeePerGas: BigNumberish
    ], [
        void
    ], "nonpayable">;
    renounceOwnership: TypedContractMethod<[], [void], "nonpayable">;
    setMaxCostPerUserOp: TypedContractMethod<[
        _newMaxCost: BigNumberish
    ], [
        void
    ], "nonpayable">;
    transferOwnership: TypedContractMethod<[
        newOwner: AddressLike
    ], [
        void
    ], "nonpayable">;
    unlockStake: TypedContractMethod<[], [void], "nonpayable">;
    updateSigner: TypedContractMethod<[
        _newSigner: AddressLike
    ], [
        void
    ], "nonpayable">;
    validatePaymasterUserOp: TypedContractMethod<[
        userOp: PackedUserOperationStruct,
        userOpHash: BytesLike,
        maxCost: BigNumberish
    ], [
        [string, bigint] & {
            context: string;
            validationData: bigint;
        }
    ], "nonpayable">;
    verifyingSigner: TypedContractMethod<[], [string], "view">;
    withdrawStake: TypedContractMethod<[
        withdrawAddress: AddressLike
    ], [
        void
    ], "nonpayable">;
    withdrawTo: TypedContractMethod<[
        withdrawAddress: AddressLike,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "addStake"): TypedContractMethod<[unstakeDelaySec: BigNumberish], [void], "payable">;
    getFunction(nameOrSignature: "deposit"): TypedContractMethod<[], [void], "payable">;
    getFunction(nameOrSignature: "entryPoint"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "getDeposit"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "getHashWithZeroSignature"): TypedContractMethod<[
        userOp: PackedUserOperationStruct,
        validUntil: BigNumberish,
        validAfter: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "maxCostPerUserOp"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "owner"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "postOp"): TypedContractMethod<[
        mode: BigNumberish,
        context: BytesLike,
        actualGasCost: BigNumberish,
        actualUserOpFeePerGas: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "renounceOwnership"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "setMaxCostPerUserOp"): TypedContractMethod<[_newMaxCost: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "transferOwnership"): TypedContractMethod<[newOwner: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "unlockStake"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "updateSigner"): TypedContractMethod<[_newSigner: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "validatePaymasterUserOp"): TypedContractMethod<[
        userOp: PackedUserOperationStruct,
        userOpHash: BytesLike,
        maxCost: BigNumberish
    ], [
        [string, bigint] & {
            context: string;
            validationData: bigint;
        }
    ], "nonpayable">;
    getFunction(nameOrSignature: "verifyingSigner"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "withdrawStake"): TypedContractMethod<[withdrawAddress: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "withdrawTo"): TypedContractMethod<[
        withdrawAddress: AddressLike,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getEvent(key: "GasSponsored"): TypedContractEvent<GasSponsoredEvent.InputTuple, GasSponsoredEvent.OutputTuple, GasSponsoredEvent.OutputObject>;
    getEvent(key: "MaxCostUpdated"): TypedContractEvent<MaxCostUpdatedEvent.InputTuple, MaxCostUpdatedEvent.OutputTuple, MaxCostUpdatedEvent.OutputObject>;
    getEvent(key: "OwnershipTransferred"): TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
    getEvent(key: "SignerUpdated"): TypedContractEvent<SignerUpdatedEvent.InputTuple, SignerUpdatedEvent.OutputTuple, SignerUpdatedEvent.OutputObject>;
    filters: {
        "GasSponsored(address,uint256)": TypedContractEvent<GasSponsoredEvent.InputTuple, GasSponsoredEvent.OutputTuple, GasSponsoredEvent.OutputObject>;
        GasSponsored: TypedContractEvent<GasSponsoredEvent.InputTuple, GasSponsoredEvent.OutputTuple, GasSponsoredEvent.OutputObject>;
        "MaxCostUpdated(uint256,uint256)": TypedContractEvent<MaxCostUpdatedEvent.InputTuple, MaxCostUpdatedEvent.OutputTuple, MaxCostUpdatedEvent.OutputObject>;
        MaxCostUpdated: TypedContractEvent<MaxCostUpdatedEvent.InputTuple, MaxCostUpdatedEvent.OutputTuple, MaxCostUpdatedEvent.OutputObject>;
        "OwnershipTransferred(address,address)": TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        OwnershipTransferred: TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        "SignerUpdated(address,address)": TypedContractEvent<SignerUpdatedEvent.InputTuple, SignerUpdatedEvent.OutputTuple, SignerUpdatedEvent.OutputObject>;
        SignerUpdated: TypedContractEvent<SignerUpdatedEvent.InputTuple, SignerUpdatedEvent.OutputTuple, SignerUpdatedEvent.OutputObject>;
    };
}
//# sourceMappingURL=BelrosePaymaster.d.ts.map