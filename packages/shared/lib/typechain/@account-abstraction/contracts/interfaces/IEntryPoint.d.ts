import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../../../common";
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
export declare namespace IStakeManager {
    type DepositInfoStruct = {
        deposit: BigNumberish;
        staked: boolean;
        stake: BigNumberish;
        unstakeDelaySec: BigNumberish;
        withdrawTime: BigNumberish;
    };
    type DepositInfoStructOutput = [
        deposit: bigint,
        staked: boolean,
        stake: bigint,
        unstakeDelaySec: bigint,
        withdrawTime: bigint
    ] & {
        deposit: bigint;
        staked: boolean;
        stake: bigint;
        unstakeDelaySec: bigint;
        withdrawTime: bigint;
    };
}
export declare namespace IEntryPoint {
    type UserOpsPerAggregatorStruct = {
        userOps: PackedUserOperationStruct[];
        aggregator: AddressLike;
        signature: BytesLike;
    };
    type UserOpsPerAggregatorStructOutput = [
        userOps: PackedUserOperationStructOutput[],
        aggregator: string,
        signature: string
    ] & {
        userOps: PackedUserOperationStructOutput[];
        aggregator: string;
        signature: string;
    };
}
export interface IEntryPointInterface extends Interface {
    getFunction(nameOrSignature: "addStake" | "balanceOf" | "delegateAndRevert" | "depositTo" | "getDepositInfo" | "getNonce" | "getSenderAddress" | "getUserOpHash" | "handleAggregatedOps" | "handleOps" | "incrementNonce" | "unlockStake" | "withdrawStake" | "withdrawTo"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "AccountDeployed" | "BeforeExecution" | "Deposited" | "PostOpRevertReason" | "SignatureAggregatorChanged" | "StakeLocked" | "StakeUnlocked" | "StakeWithdrawn" | "UserOperationEvent" | "UserOperationPrefundTooLow" | "UserOperationRevertReason" | "Withdrawn"): EventFragment;
    encodeFunctionData(functionFragment: "addStake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "balanceOf", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "delegateAndRevert", values: [AddressLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "depositTo", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "getDepositInfo", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "getNonce", values: [AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "getSenderAddress", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getUserOpHash", values: [PackedUserOperationStruct]): string;
    encodeFunctionData(functionFragment: "handleAggregatedOps", values: [IEntryPoint.UserOpsPerAggregatorStruct[], AddressLike]): string;
    encodeFunctionData(functionFragment: "handleOps", values: [PackedUserOperationStruct[], AddressLike]): string;
    encodeFunctionData(functionFragment: "incrementNonce", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "unlockStake", values?: undefined): string;
    encodeFunctionData(functionFragment: "withdrawStake", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "withdrawTo", values: [AddressLike, BigNumberish]): string;
    decodeFunctionResult(functionFragment: "addStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "balanceOf", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "delegateAndRevert", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "depositTo", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getDepositInfo", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getNonce", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getSenderAddress", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getUserOpHash", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "handleAggregatedOps", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "handleOps", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "incrementNonce", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "unlockStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawTo", data: BytesLike): Result;
}
export declare namespace AccountDeployedEvent {
    type InputTuple = [
        userOpHash: BytesLike,
        sender: AddressLike,
        factory: AddressLike,
        paymaster: AddressLike
    ];
    type OutputTuple = [
        userOpHash: string,
        sender: string,
        factory: string,
        paymaster: string
    ];
    interface OutputObject {
        userOpHash: string;
        sender: string;
        factory: string;
        paymaster: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace BeforeExecutionEvent {
    type InputTuple = [];
    type OutputTuple = [];
    interface OutputObject {
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace DepositedEvent {
    type InputTuple = [account: AddressLike, totalDeposit: BigNumberish];
    type OutputTuple = [account: string, totalDeposit: bigint];
    interface OutputObject {
        account: string;
        totalDeposit: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace PostOpRevertReasonEvent {
    type InputTuple = [
        userOpHash: BytesLike,
        sender: AddressLike,
        nonce: BigNumberish,
        revertReason: BytesLike
    ];
    type OutputTuple = [
        userOpHash: string,
        sender: string,
        nonce: bigint,
        revertReason: string
    ];
    interface OutputObject {
        userOpHash: string;
        sender: string;
        nonce: bigint;
        revertReason: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace SignatureAggregatorChangedEvent {
    type InputTuple = [aggregator: AddressLike];
    type OutputTuple = [aggregator: string];
    interface OutputObject {
        aggregator: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace StakeLockedEvent {
    type InputTuple = [
        account: AddressLike,
        totalStaked: BigNumberish,
        unstakeDelaySec: BigNumberish
    ];
    type OutputTuple = [
        account: string,
        totalStaked: bigint,
        unstakeDelaySec: bigint
    ];
    interface OutputObject {
        account: string;
        totalStaked: bigint;
        unstakeDelaySec: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace StakeUnlockedEvent {
    type InputTuple = [account: AddressLike, withdrawTime: BigNumberish];
    type OutputTuple = [account: string, withdrawTime: bigint];
    interface OutputObject {
        account: string;
        withdrawTime: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace StakeWithdrawnEvent {
    type InputTuple = [
        account: AddressLike,
        withdrawAddress: AddressLike,
        amount: BigNumberish
    ];
    type OutputTuple = [
        account: string,
        withdrawAddress: string,
        amount: bigint
    ];
    interface OutputObject {
        account: string;
        withdrawAddress: string;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace UserOperationEventEvent {
    type InputTuple = [
        userOpHash: BytesLike,
        sender: AddressLike,
        paymaster: AddressLike,
        nonce: BigNumberish,
        success: boolean,
        actualGasCost: BigNumberish,
        actualGasUsed: BigNumberish
    ];
    type OutputTuple = [
        userOpHash: string,
        sender: string,
        paymaster: string,
        nonce: bigint,
        success: boolean,
        actualGasCost: bigint,
        actualGasUsed: bigint
    ];
    interface OutputObject {
        userOpHash: string;
        sender: string;
        paymaster: string;
        nonce: bigint;
        success: boolean;
        actualGasCost: bigint;
        actualGasUsed: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace UserOperationPrefundTooLowEvent {
    type InputTuple = [
        userOpHash: BytesLike,
        sender: AddressLike,
        nonce: BigNumberish
    ];
    type OutputTuple = [userOpHash: string, sender: string, nonce: bigint];
    interface OutputObject {
        userOpHash: string;
        sender: string;
        nonce: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace UserOperationRevertReasonEvent {
    type InputTuple = [
        userOpHash: BytesLike,
        sender: AddressLike,
        nonce: BigNumberish,
        revertReason: BytesLike
    ];
    type OutputTuple = [
        userOpHash: string,
        sender: string,
        nonce: bigint,
        revertReason: string
    ];
    interface OutputObject {
        userOpHash: string;
        sender: string;
        nonce: bigint;
        revertReason: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace WithdrawnEvent {
    type InputTuple = [
        account: AddressLike,
        withdrawAddress: AddressLike,
        amount: BigNumberish
    ];
    type OutputTuple = [
        account: string,
        withdrawAddress: string,
        amount: bigint
    ];
    interface OutputObject {
        account: string;
        withdrawAddress: string;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export interface IEntryPoint extends BaseContract {
    connect(runner?: ContractRunner | null): IEntryPoint;
    waitForDeployment(): Promise<this>;
    interface: IEntryPointInterface;
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
        _unstakeDelaySec: BigNumberish
    ], [
        void
    ], "payable">;
    balanceOf: TypedContractMethod<[account: AddressLike], [bigint], "view">;
    delegateAndRevert: TypedContractMethod<[
        target: AddressLike,
        data: BytesLike
    ], [
        void
    ], "nonpayable">;
    depositTo: TypedContractMethod<[account: AddressLike], [void], "payable">;
    getDepositInfo: TypedContractMethod<[
        account: AddressLike
    ], [
        IStakeManager.DepositInfoStructOutput
    ], "view">;
    getNonce: TypedContractMethod<[
        sender: AddressLike,
        key: BigNumberish
    ], [
        bigint
    ], "view">;
    getSenderAddress: TypedContractMethod<[
        initCode: BytesLike
    ], [
        void
    ], "nonpayable">;
    getUserOpHash: TypedContractMethod<[
        userOp: PackedUserOperationStruct
    ], [
        string
    ], "view">;
    handleAggregatedOps: TypedContractMethod<[
        opsPerAggregator: IEntryPoint.UserOpsPerAggregatorStruct[],
        beneficiary: AddressLike
    ], [
        void
    ], "nonpayable">;
    handleOps: TypedContractMethod<[
        ops: PackedUserOperationStruct[],
        beneficiary: AddressLike
    ], [
        void
    ], "nonpayable">;
    incrementNonce: TypedContractMethod<[
        key: BigNumberish
    ], [
        void
    ], "nonpayable">;
    unlockStake: TypedContractMethod<[], [void], "nonpayable">;
    withdrawStake: TypedContractMethod<[
        withdrawAddress: AddressLike
    ], [
        void
    ], "nonpayable">;
    withdrawTo: TypedContractMethod<[
        withdrawAddress: AddressLike,
        withdrawAmount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "addStake"): TypedContractMethod<[_unstakeDelaySec: BigNumberish], [void], "payable">;
    getFunction(nameOrSignature: "balanceOf"): TypedContractMethod<[account: AddressLike], [bigint], "view">;
    getFunction(nameOrSignature: "delegateAndRevert"): TypedContractMethod<[
        target: AddressLike,
        data: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "depositTo"): TypedContractMethod<[account: AddressLike], [void], "payable">;
    getFunction(nameOrSignature: "getDepositInfo"): TypedContractMethod<[
        account: AddressLike
    ], [
        IStakeManager.DepositInfoStructOutput
    ], "view">;
    getFunction(nameOrSignature: "getNonce"): TypedContractMethod<[
        sender: AddressLike,
        key: BigNumberish
    ], [
        bigint
    ], "view">;
    getFunction(nameOrSignature: "getSenderAddress"): TypedContractMethod<[initCode: BytesLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "getUserOpHash"): TypedContractMethod<[userOp: PackedUserOperationStruct], [string], "view">;
    getFunction(nameOrSignature: "handleAggregatedOps"): TypedContractMethod<[
        opsPerAggregator: IEntryPoint.UserOpsPerAggregatorStruct[],
        beneficiary: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "handleOps"): TypedContractMethod<[
        ops: PackedUserOperationStruct[],
        beneficiary: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "incrementNonce"): TypedContractMethod<[key: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "unlockStake"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "withdrawStake"): TypedContractMethod<[withdrawAddress: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "withdrawTo"): TypedContractMethod<[
        withdrawAddress: AddressLike,
        withdrawAmount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getEvent(key: "AccountDeployed"): TypedContractEvent<AccountDeployedEvent.InputTuple, AccountDeployedEvent.OutputTuple, AccountDeployedEvent.OutputObject>;
    getEvent(key: "BeforeExecution"): TypedContractEvent<BeforeExecutionEvent.InputTuple, BeforeExecutionEvent.OutputTuple, BeforeExecutionEvent.OutputObject>;
    getEvent(key: "Deposited"): TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
    getEvent(key: "PostOpRevertReason"): TypedContractEvent<PostOpRevertReasonEvent.InputTuple, PostOpRevertReasonEvent.OutputTuple, PostOpRevertReasonEvent.OutputObject>;
    getEvent(key: "SignatureAggregatorChanged"): TypedContractEvent<SignatureAggregatorChangedEvent.InputTuple, SignatureAggregatorChangedEvent.OutputTuple, SignatureAggregatorChangedEvent.OutputObject>;
    getEvent(key: "StakeLocked"): TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
    getEvent(key: "StakeUnlocked"): TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
    getEvent(key: "StakeWithdrawn"): TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
    getEvent(key: "UserOperationEvent"): TypedContractEvent<UserOperationEventEvent.InputTuple, UserOperationEventEvent.OutputTuple, UserOperationEventEvent.OutputObject>;
    getEvent(key: "UserOperationPrefundTooLow"): TypedContractEvent<UserOperationPrefundTooLowEvent.InputTuple, UserOperationPrefundTooLowEvent.OutputTuple, UserOperationPrefundTooLowEvent.OutputObject>;
    getEvent(key: "UserOperationRevertReason"): TypedContractEvent<UserOperationRevertReasonEvent.InputTuple, UserOperationRevertReasonEvent.OutputTuple, UserOperationRevertReasonEvent.OutputObject>;
    getEvent(key: "Withdrawn"): TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
    filters: {
        "AccountDeployed(bytes32,address,address,address)": TypedContractEvent<AccountDeployedEvent.InputTuple, AccountDeployedEvent.OutputTuple, AccountDeployedEvent.OutputObject>;
        AccountDeployed: TypedContractEvent<AccountDeployedEvent.InputTuple, AccountDeployedEvent.OutputTuple, AccountDeployedEvent.OutputObject>;
        "BeforeExecution()": TypedContractEvent<BeforeExecutionEvent.InputTuple, BeforeExecutionEvent.OutputTuple, BeforeExecutionEvent.OutputObject>;
        BeforeExecution: TypedContractEvent<BeforeExecutionEvent.InputTuple, BeforeExecutionEvent.OutputTuple, BeforeExecutionEvent.OutputObject>;
        "Deposited(address,uint256)": TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
        Deposited: TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
        "PostOpRevertReason(bytes32,address,uint256,bytes)": TypedContractEvent<PostOpRevertReasonEvent.InputTuple, PostOpRevertReasonEvent.OutputTuple, PostOpRevertReasonEvent.OutputObject>;
        PostOpRevertReason: TypedContractEvent<PostOpRevertReasonEvent.InputTuple, PostOpRevertReasonEvent.OutputTuple, PostOpRevertReasonEvent.OutputObject>;
        "SignatureAggregatorChanged(address)": TypedContractEvent<SignatureAggregatorChangedEvent.InputTuple, SignatureAggregatorChangedEvent.OutputTuple, SignatureAggregatorChangedEvent.OutputObject>;
        SignatureAggregatorChanged: TypedContractEvent<SignatureAggregatorChangedEvent.InputTuple, SignatureAggregatorChangedEvent.OutputTuple, SignatureAggregatorChangedEvent.OutputObject>;
        "StakeLocked(address,uint256,uint256)": TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
        StakeLocked: TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
        "StakeUnlocked(address,uint256)": TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
        StakeUnlocked: TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
        "StakeWithdrawn(address,address,uint256)": TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
        StakeWithdrawn: TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
        "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)": TypedContractEvent<UserOperationEventEvent.InputTuple, UserOperationEventEvent.OutputTuple, UserOperationEventEvent.OutputObject>;
        UserOperationEvent: TypedContractEvent<UserOperationEventEvent.InputTuple, UserOperationEventEvent.OutputTuple, UserOperationEventEvent.OutputObject>;
        "UserOperationPrefundTooLow(bytes32,address,uint256)": TypedContractEvent<UserOperationPrefundTooLowEvent.InputTuple, UserOperationPrefundTooLowEvent.OutputTuple, UserOperationPrefundTooLowEvent.OutputObject>;
        UserOperationPrefundTooLow: TypedContractEvent<UserOperationPrefundTooLowEvent.InputTuple, UserOperationPrefundTooLowEvent.OutputTuple, UserOperationPrefundTooLowEvent.OutputObject>;
        "UserOperationRevertReason(bytes32,address,uint256,bytes)": TypedContractEvent<UserOperationRevertReasonEvent.InputTuple, UserOperationRevertReasonEvent.OutputTuple, UserOperationRevertReasonEvent.OutputObject>;
        UserOperationRevertReason: TypedContractEvent<UserOperationRevertReasonEvent.InputTuple, UserOperationRevertReasonEvent.OutputTuple, UserOperationRevertReasonEvent.OutputObject>;
        "Withdrawn(address,address,uint256)": TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
        Withdrawn: TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
    };
}
//# sourceMappingURL=IEntryPoint.d.ts.map