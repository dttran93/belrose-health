import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../../../common";
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
export interface IStakeManagerInterface extends Interface {
    getFunction(nameOrSignature: "addStake" | "balanceOf" | "depositTo" | "getDepositInfo" | "unlockStake" | "withdrawStake" | "withdrawTo"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "Deposited" | "StakeLocked" | "StakeUnlocked" | "StakeWithdrawn" | "Withdrawn"): EventFragment;
    encodeFunctionData(functionFragment: "addStake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "balanceOf", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "depositTo", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "getDepositInfo", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "unlockStake", values?: undefined): string;
    encodeFunctionData(functionFragment: "withdrawStake", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "withdrawTo", values: [AddressLike, BigNumberish]): string;
    decodeFunctionResult(functionFragment: "addStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "balanceOf", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "depositTo", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getDepositInfo", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "unlockStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "withdrawTo", data: BytesLike): Result;
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
export interface IStakeManager extends BaseContract {
    connect(runner?: ContractRunner | null): IStakeManager;
    waitForDeployment(): Promise<this>;
    interface: IStakeManagerInterface;
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
    depositTo: TypedContractMethod<[account: AddressLike], [void], "payable">;
    getDepositInfo: TypedContractMethod<[
        account: AddressLike
    ], [
        IStakeManager.DepositInfoStructOutput
    ], "view">;
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
    getFunction(nameOrSignature: "depositTo"): TypedContractMethod<[account: AddressLike], [void], "payable">;
    getFunction(nameOrSignature: "getDepositInfo"): TypedContractMethod<[
        account: AddressLike
    ], [
        IStakeManager.DepositInfoStructOutput
    ], "view">;
    getFunction(nameOrSignature: "unlockStake"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "withdrawStake"): TypedContractMethod<[withdrawAddress: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "withdrawTo"): TypedContractMethod<[
        withdrawAddress: AddressLike,
        withdrawAmount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getEvent(key: "Deposited"): TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
    getEvent(key: "StakeLocked"): TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
    getEvent(key: "StakeUnlocked"): TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
    getEvent(key: "StakeWithdrawn"): TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
    getEvent(key: "Withdrawn"): TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
    filters: {
        "Deposited(address,uint256)": TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
        Deposited: TypedContractEvent<DepositedEvent.InputTuple, DepositedEvent.OutputTuple, DepositedEvent.OutputObject>;
        "StakeLocked(address,uint256,uint256)": TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
        StakeLocked: TypedContractEvent<StakeLockedEvent.InputTuple, StakeLockedEvent.OutputTuple, StakeLockedEvent.OutputObject>;
        "StakeUnlocked(address,uint256)": TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
        StakeUnlocked: TypedContractEvent<StakeUnlockedEvent.InputTuple, StakeUnlockedEvent.OutputTuple, StakeUnlockedEvent.OutputObject>;
        "StakeWithdrawn(address,address,uint256)": TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
        StakeWithdrawn: TypedContractEvent<StakeWithdrawnEvent.InputTuple, StakeWithdrawnEvent.OutputTuple, StakeWithdrawnEvent.OutputObject>;
        "Withdrawn(address,address,uint256)": TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
        Withdrawn: TypedContractEvent<WithdrawnEvent.InputTuple, WithdrawnEvent.OutputTuple, WithdrawnEvent.OutputObject>;
    };
}
//# sourceMappingURL=IStakeManager.d.ts.map